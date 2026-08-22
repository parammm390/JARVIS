import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closePool, getPool } from "@finnor/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_COLUMN = /(?:secret|password|token|private_key|credential_ref|cookie|session|content|transcript|recording|raw|payload|prompt|response|storage_ref)/i;
const AUDIT_TABLE = /(?:event|receipt|audit|ledger|financial|invoice|payment|work_event_wake)/i;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe database identifier: ${value}`);
  return `"${value}"`;
}

async function main(): Promise<void> {
  const tenantId = argument("--tenant-id");
  const output = argument("--output-file");
  if (!tenantId || !UUID.test(tenantId)) {
    throw new Error("Usage: tsx scripts/tenant-data-inventory.ts --tenant-id <uuid> [--output-file <path>]");
  }

  const pool = getPool();
  const tenant = await pool.query<{ client_key: string; name: string }>(
    "SELECT client_key,name FROM finnor_os.tenants WHERE id=$1",
    [tenantId],
  );
  if (tenant.rowCount !== 1) throw new Error("Tenant was not found");

  const columns = await pool.query<{ table_name: string; column_name: string; data_type: string }>(`
    SELECT table_name,column_name,data_type
      FROM information_schema.columns
     WHERE table_schema='finnor_os'
     ORDER BY table_name,ordinal_position
  `);
  const byTable = new Map<string, Array<{ name: string; type: string }>>();
  for (const row of columns.rows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push({ name: row.column_name, type: row.data_type });
    byTable.set(row.table_name, list);
  }

  const tables = [];
  for (const [table, tableColumns] of [...byTable.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!tableColumns.some((column) => column.name === "tenant_id")) continue;
    const count = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM finnor_os.${quotedIdentifier(table)} WHERE tenant_id=$1`,
      [tenantId],
    );
    tables.push({
      table,
      tenantSelector: "tenant_id",
      rowCount: count.rows[0]?.count ?? 0,
      columns: tableColumns.map((column) => column.name),
      sensitiveColumns: tableColumns.filter((column) => SENSITIVE_COLUMN.test(column.name)).map((column) => column.name),
      lifecycle: table === "computer_artifacts"
        ? "redact-content-preserve-evidence"
        : AUDIT_TABLE.test(table) ? "policy-or-legal-review-required" : "tenant-retention-policy",
    });
  }

  const indirectJobs = await pool.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM finnor_os.jobs WHERE payload->>'tenantId'=$1",
    [tenantId],
  );
  const inventory = {
    schema: "finnor.tenant-data-inventory/v1",
    generatedAt: new Date().toISOString(),
    tenant: { id: tenantId, clientKey: tenant.rows[0]!.client_key, name: tenant.rows[0]!.name },
    mode: "metadata-only",
    directTenantTables: tables,
    indirectTenantStores: [{
      table: "jobs",
      tenantSelector: "payload.tenantId",
      rowCount: indirectJobs.rows[0]?.count ?? 0,
      sensitiveColumns: ["payload", "last_error"],
      lifecycle: "tenant-retention-policy-with-wake-linked-protection",
    }],
    exclusions: [
      "managed secret values are not stored in Postgres and are never exported",
      "global release, migration, and worker-health records are not tenant data",
      "this command identifies data; deletion still requires the configured retention/legal-hold workflow",
    ],
  };
  const serialized = `${JSON.stringify(inventory, null, 2)}\n`;
  if (output) await writeFile(resolve(output), serialized, { mode: 0o600 });
  process.stdout.write(serialized);
}

void main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closePool());
