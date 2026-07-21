// Observability — Sentry error tracking + LLM/integration call breadcrumbs, riding on
// the same two chokepoints as everything else in this codebase: ToolRegistry.call()
// (every external side effect) and errorResponse() (apps/api/lib/auth.ts, every
// unhandled route error). Sentry.init() no-ops harmlessly without a DSN — safe to
// ship inert until the founder creates a Sentry project and sets SENTRY_DSN.
// initObservability() is idempotent (safe to call from multiple entry points/chokepoints).

import * as Sentry from "@sentry/node";

let initialized = false;

export function initObservability(): void {
  if (initialized) return;
  initialized = true;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.SENTRY_DSN ? 0.1 : 0,
    // A2.T3: release-tagged by git SHA — Vercel (api) and Railway (worker) both inject
    // their own commit-sha env var name; whichever platform this runs on wins.
    release: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA,
  });
}

export { Sentry };
