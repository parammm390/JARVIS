import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { closePool, pgConnectionConfig } from "@finnor/db";
import { parseImportDefinition, runDeclarativeImport } from "@finnor/import-engine";
import { resolveTenantCredentialContext, TenantCredentialError } from "@finnor/security";

type Evidence = {
  commitSha: string;
  database: { businessCounts: Record<string, number> };
};

async function main(): Promise<void> {
  const [envPath, evidencePath] = process.argv.slice(2);
  if (!envPath || !evidencePath) throw new Error("Usage: tsx production-smoke.ts <production-env-file> <preflight-evidence>");
  process.loadEnvFile(envPath);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as Evidence;
  if (evidence.commitSha !== process.env.FINNOR_COMMIT_SHA) throw new Error("smoke evidence SHA does not match this release");
  const databaseUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!databaseUrl) throw new Error("MIGRATIONS_DATABASE_URL is missing");
  // The workflow deliberately uses a local DATABASE_URL for pre-deploy tests. Force
  // every imported DB/security/import module in this smoke onto the protected
  // production connection; process.loadEnvFile() does not replace existing values.
  process.env.DATABASE_URL = databaseUrl;
  const client = new pg.Client(pgConnectionConfig(databaseUrl));
  await client.connect();
  try {
    const tenants = await client.query<{ id: string }>("SELECT id FROM finnor_os.tenants ORDER BY created_at LIMIT 2");
    if (!tenants.rows[0]) throw new Error("production has no existing tenant to verify");
    const tenantId = tenants.rows[0].id;

    const before = await client.query(`
      SELECT
        (SELECT count(*)::int FROM finnor_os.tenants) AS tenants,
        (SELECT count(*)::int FROM finnor_os.users) AS users,
        (SELECT count(*)::int FROM finnor_os.households) AS households,
        (SELECT count(*)::int FROM finnor_os.leads) AS leads,
        (SELECT count(*)::int FROM finnor_os.equipment) AS equipment,
        (SELECT count(*)::int FROM finnor_os.work_orders) AS work_orders
    `);
    if (JSON.stringify(before.rows[0]) !== JSON.stringify(evidence.database.businessCounts)) {
      throw new Error("business row counts changed between preflight and smoke");
    }

    let failedClosed = false;
    try {
      await resolveTenantCredentialContext(randomUUID(), "stripe");
    } catch (error) {
      failedClosed = error instanceof TenantCredentialError && error.code === "integration_not_bound";
    }
    if (!failedClosed) throw new Error("unknown tenant credential resolution did not fail closed");

    const definition = parseImportDefinition({
      key: "release-smoke-customer",
      version: 1,
      format: "csv",
      entity: "customer",
      sourceSystem: "finnor-release-smoke",
      externalId: { from: "id" },
      fields: { name: { from: "name" }, email: { from: "email" } },
    });
    const importReport = await runDeclarativeImport({
      tenantId,
      definition,
      source: { name: `release-smoke-${evidence.commitSha}.csv`, content: `id,name,email\nrelease-${evidence.commitSha},Release Smoke,release-smoke@example.invalid\n` },
      dryRun: true,
    });
    if (!importReport.dryRun || importReport.planned !== 1 || importReport.created !== 0 || importReport.updated !== 0) {
      throw new Error("declarative importer dry-run did not remain plan-only");
    }

    const idempotencyKey = `release-probe:${evidence.commitSha}:${randomUUID()}`;
    await client.query(
      `INSERT INTO finnor_os.jobs (type, payload, idempotency_key, lane, priority)
       VALUES ('release_probe', $1::jsonb, $2, 'interactive', 100)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [JSON.stringify({ commitSha: evidence.commitSha }), idempotencyKey],
    );
    let jobStatus = "unknown";
    for (let attempt = 0; attempt < 45; attempt++) {
      const job = await client.query<{ status: string; last_error: string | null }>(
        "SELECT status, last_error FROM finnor_os.jobs WHERE idempotency_key = $1",
        [idempotencyKey],
      );
      jobStatus = job.rows[0]?.status ?? "missing";
      if (jobStatus === "completed") break;
      if (["failed", "dead_letter"].includes(jobStatus)) throw new Error(`release probe failed: ${job.rows[0]?.last_error ?? jobStatus}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (jobStatus !== "completed") throw new Error(`release probe did not complete (status ${jobStatus})`);

    const after = await client.query(`
      SELECT
        (SELECT count(*)::int FROM finnor_os.tenants) AS tenants,
        (SELECT count(*)::int FROM finnor_os.users) AS users,
        (SELECT count(*)::int FROM finnor_os.households) AS households,
        (SELECT count(*)::int FROM finnor_os.leads) AS leads,
        (SELECT count(*)::int FROM finnor_os.equipment) AS equipment,
        (SELECT count(*)::int FROM finnor_os.work_orders) AS work_orders
    `);
    if (JSON.stringify(after.rows[0]) !== JSON.stringify(before.rows[0])) throw new Error("production smoke mutated business data");

    console.log(JSON.stringify({
      ok: true,
      commitSha: evidence.commitSha,
      tenantsIntact: true,
      tenantCredentialResolution: "failed-closed",
      importerDryRun: { planned: importReport.planned, businessDataMutation: 0 },
      queueProbe: jobStatus,
    }, null, 2));
  } finally {
    await client.end();
    await closePool();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
