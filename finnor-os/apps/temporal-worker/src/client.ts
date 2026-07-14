// Shared Temporal client helper — connects to Temporal Cloud (production) or a local
// dev server (TEMPORAL_ADDRESS defaults to localhost:7233), matching the same
// "explicit env vars, no fabricated success" posture every other integration in
// packages/tools already follows.

import { Client, Connection } from "@temporalio/client";

export const AMC_RENEWAL_TASK_QUEUE = "finnor-amc-renewal";

let client: Client | null = null;

export async function getTemporalClient(): Promise<Client> {
  if (client) return client;
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    tls: process.env.TEMPORAL_API_KEY ? {} : undefined,
    apiKey: process.env.TEMPORAL_API_KEY,
  });
  client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "default" });
  return client;
}

export function amcRenewalWorkflowId(agreementId: string): string {
  return `amc-renewal:${agreementId}`;
}
