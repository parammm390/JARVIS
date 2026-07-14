// Standalone load/connection-pool test — NOT part of the CI test suite (that's
// tests/integration/pool-load.test.ts, kept fast). This drives real concurrent gated
// actions through the real FinnorOrchestrator pipeline against real Postgres, at a
// scale a CI test shouldn't attempt, to prove the max:2 (production) connection pool
// holds up under realistic concurrent traffic before it ever meets a real dealer.
//
// Usage: npx tsx scripts/load-test.ts --concurrency=100
// Requires DATABASE_URL pointed at a real (dev/staging) Postgres — migrate()+seed()
// run automatically if needed.

import { migrate } from "../packages/db/migrate";
import { seed, SEED_TENANT_ID } from "../packages/db/seed";
import { closePool } from "@finnor/db";
import { FinnorOrchestrator } from "@finnor/orchestration";

function parseConcurrency(): number {
  const arg = process.argv.find((a) => a.startsWith("--concurrency="));
  const n = arg ? Number(arg.split("=")[1]) : 50;
  return Number.isFinite(n) && n > 0 ? n : 50;
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL ?? "postgres://finnor:finnor@localhost:5432/finnor";
  process.env.DATABASE_URL = dbUrl;
  const concurrency = parseConcurrency();

  console.log(`[load-test] migrating + seeding against ${dbUrl}`);
  await migrate(dbUrl);
  await seed(dbUrl);

  const orchestrator = new FinnorOrchestrator();
  console.log(`[load-test] firing ${concurrency} concurrent draftKnownAction("schedule_water_test", ...) calls`);

  const start = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: concurrency }, (_, i) =>
      orchestrator.draftKnownAction(
        "schedule_water_test",
        {
          address: `${i} Load Test Ln, Cedar Falls, IA`,
          contactPhone: `+1999555${String(i).padStart(4, "0")}`,
          contactName: `Load Test Subject ${i}`,
        },
        SEED_TENANT_ID,
        { source: "load_test" },
      ),
    ),
  );
  const elapsedMs = Date.now() - start;

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected");
  console.log(`[load-test] ${fulfilled}/${concurrency} succeeded in ${elapsedMs}ms (${(elapsedMs / concurrency).toFixed(1)}ms/call avg)`);
  if (rejected.length > 0) {
    console.error(`[load-test] ${rejected.length} FAILED:`);
    for (const r of rejected.slice(0, 5)) console.error("  -", (r as PromiseRejectedResult).reason);
  }

  await closePool();
  process.exit(rejected.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
