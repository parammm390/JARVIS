// A2.T3: Next.js instrumentation hook — the currently-recommended way to load
// sentry.server.config.ts/sentry.edge.config.ts (see @sentry/nextjs's own deprecation
// warning against the old auto-injected pattern this replaces).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
