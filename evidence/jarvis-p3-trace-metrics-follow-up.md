# P3 trace-metrics follow-up — 2026-08-03

## Scope

This follow-up strengthens the measurement path for the canonical `/jarvis`
route. It does not create workflow state, alter authorization, or convert a
fixture into tenant evidence.

## Narrow source change

- [`trace-metrics.ts`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/trace-metrics.ts)
  now mirrors the existing in-memory measurements into an ephemeral browser
  inspection copy. The copy is derived from the same measured event-received
  and next-paint values; it cannot drive the kernel.
- [`Thread.tsx`](/Users/paramdave/FINNOR/src/components/jarvis/bridge/Thread.tsx)
  exposes the current instruction's measured rows on the existing Thread
  document through non-visual `data-jarvis-trace-metrics-count` and
  `data-jarvis-trace-metrics` attributes. No customer-facing panel or business
  state was added.
- [`trace-metrics.test.ts`](/Users/paramdave/FINNOR/src/components/jarvis/kernel/trace-metrics.test.ts)
  covers the inspection-copy behavior.

## Verification

- Focused Thread/kernel run: **3 files / 36 tests passed**.
- Full unit suite: **34 files / 397 tests passed**.
- Root TypeScript: `npx tsc --noEmit --pretty false` exited **0**.
- Changed-source ESLint and `git diff --check` exited **0**.
- Complete labelled P3 Playwright regression: **24/24 passed (32.5s)** at the
  configured 1440/390/reduced-motion fixture paths.
- Read-only realtime preflight: `npm run jarvis:realtime:verify` — **PASS**;
  it made no database or deployment calls.

## Deployment

The measurement-only follow-up was published under the authorization already
recorded in the state ledger. The latest deployment is
`dpl_9W82UCm8TkDBZow5e2jJynBjDv6e`, inspected as `READY` and aliased to
`https://finnorai.com`. The build retained the existing Sentry ESM and
edge-runtime warnings; no new build error was observed.

## Live owner observations

After the earlier measurement-enabled deployment, a bounded live owner run at
the existing 1470px-wide Chrome surface submitted exactly:

```text
Book a water test for the Hendersons this week and give it to whoever's closest
```

The sampled visible edges were:

```text
~157 ms   Heard / thinking
~2226 ms  Heard + Understood + Plan / thinking
~4867 ms  Heard + Understood + Plan / Clarify / decision
```

The final live clarification control was focused; the observed document width
was `1462px` with no horizontal overflow. This is live state-edge timing from
submission observation, not event-receipt→paint timing. The browser-control
evaluation surface could not inspect arbitrary page `window` properties, so a
missing/empty inspection value is not interpreted as proof that the backend
emitted no events. The final non-visual DOM inspection seam was deployed after
this sample, but a repeat was stopped by the route's observed rate limit before
it could produce a trustworthy final-run metric record.

The latest bounded reload after the final deployment first showed the exact
rate-limit error `Rate limit exceeded — slow down and try again shortly`. After
60 seconds without further probes, the owner route recovered to the observed
degraded shell: `Needs attention`, `Connection status is unavailable.`, no
Thread blocks, and `5 approvals waiting`. The count is recorded as observed UI
state only; no causal attribution is made.

## Runtime boundary

The read-only probes to the guessed worker paths `/healthz`, `/health`, and
`/events` each returned HTTP 404, while the canonical unknown instruction-event
request returned HTTP 401. These results do not establish the production
migration ledger or the availability of a valid authenticated event trace.
The finnor-os typecheck and instruction-route integration test produced no
verdict after repeated bounded waits and were stopped with exit 130; they are
not counted as passing evidence.

## Gate consequence

The instrumentation is verified in source/tests and the fixture runtime, but
it does not close live SSE/poll event→pixel timing, live transition CLS,
mid-flight restore, the complete separately-timestamped live lifecycle, or the
authoritative ≥87/100 score artifact. P3 remains **2/7 supported** and the
evidence-backed score remains **10/100**. No phase completion is claimed.
