/** Stable proxy timeout contract shared by the route and its contract tests.
 * Keeping these constants outside the route module avoids Next.js treating them
 * as unsupported route exports while still making the boundary testable. */
export const JARVIS_PROXY_READ_TIMEOUT_MS = 10_000
// Durable approvals can synchronously cross the planner/executor boundary and take
// just over 30s on a cold worker. Keep the proxy alive long enough to return the
// committed receipt instead of manufacturing a client-visible timeout after the
// action has already succeeded.
export const JARVIS_PROXY_WRITE_TIMEOUT_MS = 60_000
