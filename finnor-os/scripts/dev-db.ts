// Dockerless local database: boots an embedded Postgres 16 on :5432 with the same
// credentials docker-compose would provide (finnor/finnor/finnor). Use docker-compose
// if you have Docker — this exists so the stack runs on machines without it.
// Usage: npx tsx scripts/dev-db.ts   (keeps running; Ctrl-C to stop)

import EmbeddedPostgres from "embedded-postgres";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", ".devdb");

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "finnor",
  password: "finnor",
  port: 5432,
  persistent: true,
});

async function main() {
  const fresh = !(await import("node:fs")).existsSync(join(dataDir, "PG_VERSION"));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("finnor");
  console.log("[dev-db] Postgres running at postgres://finnor:finnor@localhost:5432/finnor");
  console.log("[dev-db] Ctrl-C to stop.");
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => undefined);
  process.exit(1);
});
