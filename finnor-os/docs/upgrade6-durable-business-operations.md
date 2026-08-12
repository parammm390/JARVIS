# Upgrade 6: Durable Business Operations

Upgrade 6 promotes customer win-back from one synchronous bulk action into a durable business operation while retaining the existing domain-action, approval, Work Kernel, job, tool, policy, and receipt infrastructure.

## Production path

1. `bulk_notify_existing_customers` evaluates the inactivity query and previews personalized work.
2. Before approval, the executor creates one `customer_winback` operation and freezes the exact evaluated household IDs, contextual snapshots, personalized payloads, configuration, and ordering into per-target rows.
3. Approval atomically authorizes the operation and enqueues its first dispatcher job. Approval does not execute the campaign request loop.
4. The dispatcher performs bounded fan-out. SMS targets receive individual jobs; call targets receive capacity-bounded batch jobs and a future continuation job when the dealer-local daily cap is exhausted.
5. Workers re-check live consent, household existence, phone validity, and contact drift immediately before an effect. The approved cohort never expands.
6. Every target advances independently through `pending`, `running`, `succeeded`, `failed`, `skipped`, or `retry`, with leases, attempt counts, typed failures, evidence, and append-only operation events.
7. Aggregate counters, the domain action, Decision Receipt, and Work Case projection are reconciled continuously. The Jarvis Work workspace displays frozen cohort size and resolved/succeeded/retry/failed/skipped progress.

## Delivery and recovery guarantees

- Tool effects are scoped by operation and target. A successful provider operation is replayed from the durable external-operation ledger, preventing duplicate sends or campaigns after a crash.
- Sandbox Vapi writes a visible simulated outbox result with `providerAccepted: false`; it never claims provider delivery.
- Retryable failures receive bounded exponential retries. Expired target leases are reclaimed by dispatcher watchdogs.
- Policy failures are skipped and never recoverable by retry. Invalid-input failures remain terminal until data is corrected through an explicit human path. Configuration and human-review failures require authorized recovery.
- Recovery resets only eligible failed targets. Successful and policy-skipped targets are never replayed. A caller-supplied recovery key makes the recovery request itself idempotent.
- Calling-budget reservations use stable batch keys, release only unused capacity, and schedule unprocessed targets in the next dealer-local calling window rather than dropping them.

## Operational interfaces

- `GET /api/operations/{id}` returns the tenant-scoped operation, targets, events, and durable receipt.
- `POST /api/operations/{id}/retry` authorizes selective recovery using a unique `recoveryKey`.
- `GET /api/works/{id}` includes operation state and target-derived customer links for continuous Work Kernel observation.
- PostgreSQL notifications on operation and target changes reuse the existing Jarvis event stream to invalidate projections.

The model is intentionally limited to the proven customer win-back operation. The schema and dispatcher boundaries can support another bulk operation when it has the same frozen-cohort and per-target semantics, but Upgrade 6 does not introduce a general workflow platform.
