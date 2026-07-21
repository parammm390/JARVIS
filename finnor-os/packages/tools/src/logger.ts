// Structured logging (A2.T2): one shared pino instance for api+worker so every log line
// can carry {traceId, tenantId, actionId, workflowRunId} — the correlation_id thread
// A2.T1 completed at instruction intake. Ships to Axiom when AXIOM_TOKEN/AXIOM_DATASET
// are set (any env); otherwise pretty console locally (NODE_ENV !== production) or plain
// JSON to stdout in prod without Axiom configured yet — logs are never silently dropped
// just because Axiom isn't wired up.

import pino from "pino";

function buildTargets(): pino.TransportTargetOptions[] {
  const level = process.env.LOG_LEVEL ?? "info";
  const targets: pino.TransportTargetOptions[] = [];
  const axiomToken = process.env.AXIOM_TOKEN;
  const axiomDataset = process.env.AXIOM_DATASET;
  if (axiomToken && axiomDataset) {
    targets.push({
      target: "@axiomhq/pino",
      options: { token: axiomToken, dataset: axiomDataset, axiomClient: "finnor-os" },
      level,
    });
  }
  if (process.env.NODE_ENV !== "production") {
    targets.push({
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
      level,
    });
  } else if (!(axiomToken && axiomDataset)) {
    targets.push({ target: "pino/file", options: { destination: 1 }, level });
  }
  return targets;
}

let instance: pino.Logger | null = null;

/** Idempotent, same pattern as initObservability() — safe to import from anywhere;
 *  the pino.transport() worker thread is only spun up once per process. */
export function getLogger(): pino.Logger {
  if (!instance) {
    instance = pino({ level: process.env.LOG_LEVEL ?? "info" }, pino.transport({ targets: buildTargets() }));
  }
  return instance;
}

export interface TraceFields {
  traceId?: string;
  tenantId?: string;
  actionId?: string;
  workflowRunId?: string;
  [key: string]: unknown;
}

/** Every call site should log through this, not getLogger() directly, so traceId/
 *  tenantId/actionId/workflowRunId ride along automatically wherever they're known. */
export function logWithTrace(fields: TraceFields): pino.Logger {
  return getLogger().child(fields);
}
