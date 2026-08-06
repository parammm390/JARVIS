/** Stable proxy timeout contract shared by the route and its contract tests.
 * Keeping these constants outside the route module avoids Next.js treating them
 * as unsupported route exports while still making the boundary testable. */
export const JARVIS_PROXY_READ_TIMEOUT_MS = 10_000
export const JARVIS_PROXY_WRITE_TIMEOUT_MS = 30_000
