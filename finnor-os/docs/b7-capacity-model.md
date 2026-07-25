# B7 capacity model

The nightly-lite run is deliberately a smoke/capacity-regression signal: 5 inbound events/s, 20 read-model VUs, 5 approval attempts/minute, for 60 seconds. It runs only against staging and exports the raw k6 summary as a workflow artifact.

| Workload | Current measured evidence | Capacity conclusion |
|---|---|---|
| Full target: 50 events/s, 200 reads, 20 approvals/min | `docs/load-test-2026-07-19.md` recorded 86.39% HTTP failures on the deployed staging target, with p95 pinned at k6's 60s timeout. | **Not certified.** This is the active upper bound, not a capacity claim. |
| Nightly lite: 5 events/s, 20 reads, 5 approvals/min | Workflow `k6-nightly-lite.yml` produces a versioned raw summary once the required staging secrets are configured. | Regression monitor only; no capacity number is claimed until an observed run is attached. |

The database connection limits remain the governing capacity constraint. Any “green” scorecard must be based on an observed staging workflow artifact and compare its p95/error rate to the k6 thresholds, not merely on a successful workflow launch.
