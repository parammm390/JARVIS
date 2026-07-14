// Temporal Worker process bootstrap — polls AMC_RENEWAL_TASK_QUEUE, executing
// amcRenewalSequence workflows and their activities. A separate long-running process
// from apps/worker's Postgres job queue (Part 2b of the engine-upgrade plan migrates
// the rest of that queue onto Temporal; this proof slice runs standalone).

import "dotenv/config";
import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities";
import { AMC_RENEWAL_TASK_QUEUE } from "./client";
import { fileURLToPath } from "node:url";

export async function runWorker(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: AMC_RENEWAL_TASK_QUEUE,
    workflowsPath: fileURLToPath(new URL("./workflows/amc-renewal-sequence.ts", import.meta.url)),
    activities,
    // Matches the existing Supabase Supavisor connection-pool ceiling
    // (packages/db/index.ts caps at max:2 in production) — activities call
    // withTenant()/getPool() same as every other process.
    maxConcurrentActivityTaskExecutions: 2,
  });
  console.log(`[temporal-worker] polling ${AMC_RENEWAL_TASK_QUEUE}`);
  await worker.run();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runWorker().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
