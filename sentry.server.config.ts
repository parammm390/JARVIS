// A2.T3: server-side Sentry for the root Next.js app's Node runtime routes/SSR.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: process.env.SENTRY_DSN ? 0.1 : 0,
});
