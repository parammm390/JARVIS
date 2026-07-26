# Failure-injection calendar v2

This calendar schedules drills; it does not authorize disruptive production work.
Every completed drill must add its actual outcome, timestamps, and evidence to the
tenant-scoped `finnor_os.failure_injections` journal. The existing
`GET /api/read-models/failure-injections` view is the only dashboard source.

| Drill | Cadence | Safe surface | Completion evidence |
|---|---:|---|---|
| Restore | monthly | staging | Fresh-target restore with row/content verification |
| Secrets boot | monthly | staging | Deliberately refused boot, then healthy restoration |
| Pooling load | monthly | staging | Bounded concurrent RLS probe with p50/p95 and error rate |
| Provider fault | weekly | staging | Safe-provider circuit open, alert, recovery |
| Worker kill | monthly | production only with explicit approval | Restart, heartbeat recovery, and no stranded work |

Production worker-kill and any live-provider fault remain blocked until an explicit
approval because the worker and provider circuits are shared across real tenants.
