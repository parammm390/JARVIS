// Phase 1.4: security headers on the JARVIS app + its API proxy. CSP is deliberately
// permissive on connect-src/media-src/worker-src (https:/wss:/blob: rather than an
// enumerated allowlist) because the Voice Console's @vapi-ai/web SDK talks to
// infrastructure this repo doesn't control and can't safely enumerate without risking
// breaking live voice calls — the directives that matter most for THIS incident
// (object-src, frame-ancestors, base-uri, form-action) are still locked down.
const JARVIS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ")

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
]

import { withSentryConfig } from "@sentry/nextjs"

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/resources/admissions-ai-glossary",
        destination: "/resources/dispatch-ai-glossary",
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: "/jarvis/:path*",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: JARVIS_CSP }],
      },
      {
        source: "/api/jarvis/:path*",
        headers: SECURITY_HEADERS,
      },
    ]
  },
}

// A2.T3: release-tagged Sentry (see sentry.{client,server,edge}.config.ts). Source-map
// upload only activates once SENTRY_AUTH_TOKEN/org/project are set — silent:true means
// it degrades to a no-op instead of failing the build in every env that doesn't have
// those yet (none currently do; Sentry error reporting itself doesn't need them).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: false,
  telemetry: false,
})
