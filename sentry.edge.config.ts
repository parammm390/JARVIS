// A2.T3: edge-runtime Sentry (middleware.ts / any edge route) for the root app.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.SENTRY_DSN ? 0.1 : 0,
});
