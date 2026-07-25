// Structured logging (A2.T2): one shared pino instance for api+worker so every log line
// can carry {traceId, tenantId, actionId, workflowRunId} — the correlation_id thread
// A2.T1 completed at instruction intake. Ships to Axiom when AXIOM_TOKEN/AXIOM_DATASET
// are set (any env); otherwise pretty console locally (NODE_ENV !== production) or plain
// JSON to stdout in prod without Axiom configured yet — logs are never silently dropped
// just because Axiom isn't wired up.

import pino from "pino";

/**
 * Structured PII fields that must never leave the process through Pino/Axiom.
 * This is deliberately key-based: free-text logging is prohibited at call sites
 * unless it has first passed through `redactText()` from @finnor/security.
 */
export const PII_LOG_REDACT_PATHS = [
  "email", "phone", "mobile", "address", "street", "postalCode", "zip",
  "contact.email", "contact.phone", "contact.mobile", "contact.address",
  "customer.email", "customer.phone", "customer.mobile", "customer.address",
  "household.address", "technician.email", "technician.phone",
  "payload.email", "payload.phone", "payload.mobile", "payload.address",
  "headers.authorization", "req.headers.authorization", "authorization",
  "*.email", "*.phone", "*.mobile", "*.address",
] as const;

const loggerOptions = (level: string): pino.LoggerOptions => ({
  level,
  redact: { paths: [...PII_LOG_REDACT_PATHS], censor: "[REDACTED]" },
});

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
    const level = process.env.LOG_LEVEL ?? "info";
    try {
      instance = pino(loggerOptions(level), pino.transport({ targets: buildTargets() }));
    } catch (error) {
      // A deployment must never turn an already-handled request failure into a 500
      // merely because an optional log transport was not traced into its bundle.
      // Keep the error observable on stdout and let the original error response win.
      console.error("[observability] transport unavailable; falling back to stdout:", error instanceof Error ? error.message : error);
      instance = pino(loggerOptions(level));
    }
  }
  return instance;
}

/** Test-only construction seam; avoids spawning a transport worker while proving the
 * exact bytes sent to a Pino destination are redacted. */
export function createRedactingLogger(destination: pino.DestinationStream): pino.Logger {
  return pino(loggerOptions("info"), destination);
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
