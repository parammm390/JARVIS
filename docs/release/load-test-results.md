# Phase 3 Load Test Results

**Generated:** 2026-08-07
**Candidate SHA:** `551c199` (`jarvis-release P3: add guarded staging certification runners`)
**Status:** `BLOCKED-CONFIG` — no isolated staging target or load artifacts were available.

The Node runner is implemented at `finnor-os/scripts/release/run-load-certification.ts` and uses only
built-in `fetch`. It refuses before sending a request unless staging identity, JWT mode, no-egress
posture, 25 authenticated-user tokens, the instruction fixture, and a reconciliation artifact are
present. No load request was sent and no latency or error number is claimed.

## Required scenarios

| Scenario | Exact concurrency | Exact duration | Status |
|---|---:|---:|---|
| A | 15 authenticated users | 20 minutes | `BLOCKED-CONFIG` |
| B | 25 authenticated users | 10 minutes | `BLOCKED-CONFIG` |

## Fixed gates

- API error rate `< 1%`, excluding intentional faults.
- p95 read-only `< 2.5 s`.
- p95 action draft `< 8 s`.
- p95 approval API `< 2 s`.
- Oldest ready queue age `< 30 s`.
- Zero runaway retries, tenant leaks, corruption, or duplicate effects.
- Sentry unhandled errors `= 0` and usage/cost within configured caps.

## Evidence

`docs/release/evidence/P3/p3-t8-load-guard.txt` records the non-zero fail-closed guard result and
missing inputs. The generated machine report is
`docs/release/generated/p3-load-results.json`. A successful run additionally requires a sanitized
database reconciliation artifact proving duplicate effects, tenant leaks, and data corruption are all
zero; HTTP acceptance alone is not sufficient evidence.
