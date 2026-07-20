// Backup/restore drill — proves the MECHANICS work: dump the local dev Postgres,
// restore into a throwaway database, verify row counts match, clean up. Requires
// PostgreSQL client tools (pg_dump, pg_restore, createdb, dropdb) on PATH — a normal
// dev machine (Postgres.app, `brew install postgresql`, apt) has these; this
// sandboxed embedded-postgres bundle (packages/embedded-postgres) ships ONLY the
// server binaries (postgres, initdb, pg_ctl), not the client tools, so this script
// cannot run end-to-end inside that specific environment — it's written for, and
// intended to be run from, a real development machine or CI image with Postgres
// client tools installed.
//
// Usage: npx tsx scripts/backup-restore-drill.ts

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const SOURCE_URL = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
const RESTORE_DB = `finnor_restore_drill_${Date.now()}`;

function parseConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(cmd, args, { stdio: "inherit", env });
}

async function rowCounts(url: string, tables: string[]): Promise<Record<string, number>> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM finnor_os.${t}`);
    counts[t] = rows[0].n;
  }
  await client.end();
  return counts;
}

async function main(): Promise<void> {
  const conn = parseConnection(SOURCE_URL);
  const env = { ...process.env, PGPASSWORD: conn.password };
  const dumpDir = mkdtempSync(join(tmpdir(), "finnor-backup-drill-"));
  const dumpFile = join(dumpDir, "finnor.dump");
  const tablesToCheck = ["tenants", "domain_actions", "households", "action_log"];

  try {
    console.log(`[backup-drill] dumping ${conn.database}@${conn.host}:${conn.port} -> ${dumpFile}`);
    run("pg_dump", ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", conn.database, "-Fc", "-f", dumpFile, "-n", "finnor_os"], env);

    console.log(`[backup-drill] creating throwaway database ${RESTORE_DB}`);
    run("createdb", ["-h", conn.host, "-p", conn.port, "-U", conn.user, RESTORE_DB], env);

    // Extensions are per-database, not per-cluster -- a fresh createdb has none, but
    // the dump contains objects (embeddings/embedding_cache columns) of type `vector`.
    // Without this, every such object fails to restore with `type "public.vector" does
    // not exist` -- a real, previously-unexercised gap: this drill had never actually
    // run against a pgvector-enabled source before (this repo's first-ever green CI run).
    const restoreUrl = `postgres://${conn.user}:${conn.password}@${conn.host}:${conn.port}/${RESTORE_DB}`;
    const extClient = new pg.Client({ connectionString: restoreUrl });
    await extClient.connect();
    await extClient.query("CREATE EXTENSION IF NOT EXISTS vector");
    await extClient.end();

    console.log(`[backup-drill] restoring into ${RESTORE_DB}`);
    run("pg_restore", ["-h", conn.host, "-p", conn.port, "-U", conn.user, "-d", RESTORE_DB, dumpFile], env);

    const [sourceCounts, restoredCounts] = await Promise.all([rowCounts(SOURCE_URL, tablesToCheck), rowCounts(restoreUrl, tablesToCheck)]);

    console.log("[backup-drill] row-count comparison:");
    let allMatch = true;
    for (const t of tablesToCheck) {
      const match = sourceCounts[t] === restoredCounts[t];
      allMatch &&= match;
      console.log(`  ${t}: source=${sourceCounts[t]} restored=${restoredCounts[t]} ${match ? "OK" : "MISMATCH"}`);
    }
    if (!allMatch) throw new Error("Row counts did not match after restore — drill FAILED");
    console.log("[backup-drill] PASSED — dump/restore round-trip is intact.");
  } finally {
    console.log(`[backup-drill] dropping throwaway database ${RESTORE_DB}`);
    try {
      run("dropdb", ["-h", conn.host, "-p", conn.port, "-U", conn.user, "--if-exists", RESTORE_DB], env);
    } catch (err) {
      console.error("[backup-drill] cleanup warning (drop the DB manually if this failed):", err);
    }
    rmSync(dumpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[backup-drill] FAILED:", err);
  process.exit(1);
});
