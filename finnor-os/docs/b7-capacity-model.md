# B7 capacity model

The nightly-lite run is deliberately a smoke/capacity-regression signal: 5 inbound events/s, 20 read-model VUs, 5 approval attempts/minute, for 60 seconds. It runs only against staging and exports the raw k6 summary as a workflow artifact.

| Workload | Current measured evidence | Capacity conclusion |
|---|---|---|
| Full target: 50 events/s, 200 reads, 20 approvals/min | `docs/load-test-2026-07-19.md` recorded 86.39% HTTP failures on the deployed staging target, with p95 pinned at k6's 60s timeout. | **Not certified.** This is the active upper bound, not a capacity claim. |
| Nightly lite: 5 events/s, 20 reads, 5 approvals/min | GitHub Actions [run 30175293800](https://github.com/parammm390/JARVIS/actions/runs/30175293800), 2026-07-25: 60s against the isolated Preview tenant. Inbox p95 **11.21s** (threshold <500ms); read-model p95 **18.65s** (threshold <800ms); **68.66%** HTTP failures (206/300). Raw summary artifact: `k6-nightly-lite-summary` / artifact id `8624039486`. | **Not certified.** The Preview database connection pool saturated; Vercel logs record `timeout exceeded when trying to connect`. This is an observed capacity ceiling and regression baseline, not a green claim. |

The database connection limits remain the governing capacity constraint. Any “green” scorecard must be based on an observed staging workflow artifact and compare its p95/error rate to the k6 thresholds, not merely on a successful workflow launch. Run 30175293800 meets the observation requirement but fails both thresholds; it must remain visible until a later measured remediation run succeeds.
