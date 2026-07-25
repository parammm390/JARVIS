# Degradation ladders

Vendor failure must reduce capability, never make the application unavailable or silently fabricate a success.

| Dependency | Failure behavior | Verified evidence |
|---|---|---|
| Redis | Fixed-window rate limiting uses Redis when configured; connection/command failure emits an alerting console error and uses a bounded process-local window. | `rate-limit-ladder.test.ts` 2/2 |
| Axiom | Structured logs continue to stdout and retain a bounded 200-record, independently redacted in-process tail. | `logger-pii-redaction.test.ts` 2/2 |
| Sentry | Error reporting is best-effort; route/tool failure responses and job processing remain on their normal failure paths. | `observability.test.ts` 4/4 |
| Voyage | An unavailable embedding provider fails closed; hybrid retrieval catches semantic failure and returns real structured facts with no fabricated recall. | `voyage-embedder.test.ts` 12/12; `hybrid-retrieval.test.ts` 6/6 |
| Vapi | Durable circuit breaker refuses calls after repeated failure; planner converts unavailable provider paths to a manual-step suggestion rather than an emulator. | `provider-circuit-breaker-budget.test.ts` 12/12 |
| Resend | Durable circuit breaker preserves a failed send as an explicit failure; allowlist and budget blocks remain explicit non-sends. The required queued retry window is not yet wired from the direct tool call. | `resend-adapter.test.ts` 4/4; `provider-circuit-breaker-budget.test.ts` 12/12 |

These are local/embedded-postgres chaos proofs. They do not claim a live vendor outage occurred.
