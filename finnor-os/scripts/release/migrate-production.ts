/** Apply checked-in migrations to the production owner connection before code
 * deployment. The release workflow pulls this secret from the protected Vercel
 * project; this script never prints the URL and refuses local database targets. */

import { config } from "dotenv";
import { pgConnectionConfig } from "@finnor/db";
import { migrate } from "@finnor/db/migrate";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

async function main(): Promise<void> {
  const envPath = process.argv[2];
  if (!envPath) throw new Error("Usage: npm run release:migrate:production -- <production-env-file>");
  if (process.env.FINNOR_ENVIRONMENT !== "production") {
    throw new Error("Refusing production migration without FINNOR_ENVIRONMENT=production");
  }

  const loaded = config({ path: envPath });
  if (loaded.error) throw new Error(`Unable to load protected production environment: ${loaded.error.message}`);
  const databaseUrl = process.env.MIGRATIONS_DATABASE_URL;
  if (!databaseUrl) throw new Error("MIGRATIONS_DATABASE_URL is missing from the protected production environment");

  const parsed = new URL(databaseUrl);
  if (["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("Refusing to run the production migrator against a local database");
  }

  const applied = await migrate(databaseUrl);
  const pool = new pg.Pool(pgConnectionConfig(databaseUrl));
  try {
    await new PostgresSaver(pool, undefined, { schema: "finnor_langgraph" }).setup();
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({ ok: true, applied, langGraphSchemaReady: true }));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
