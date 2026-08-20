import { createFactoryAuthFromEnv, runClientFactory } from "../../../../scripts/client-factory";

/** Existing Postgres job-queue entrypoint for durable onboarding execution. */
export async function runClientFactoryJob(payload: Record<string, unknown>): Promise<void> {
  const runId = String(payload.runId ?? "");
  if (!runId) throw new Error("run_client_factory requires runId");
  await runClientFactory(runId, { auth: createFactoryAuthFromEnv() });
}
