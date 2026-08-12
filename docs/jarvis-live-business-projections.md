# JARVIS live business projections

Upgrade 5 keeps the backend read models authoritative and makes the `/jarvis` client one tenant/session-scoped projection system.

## Audit baseline

Before Upgrade 5, `JarvisDataProvider` polled four shared lanes, while Work, Customers, Schedule, Money, Agents, Activity Theater, Pulse Bar, `views.tsx` resources, Dispatch Map, My Day, and Adaptive Workspace query results each owned separate fetch state. Several of those paths polled independently. Route-local auth/data providers also discarded state whenever navigation crossed a `/jarvis/*` page.

The backend already had the required truth sources: tenant/RLS-protected read-model and resource routes, authenticated mutation routes, business events, and per-instruction SSE. Upgrade 5 therefore adds no business tables or replacement read models. The missing mechanism was a shared client cache plus invalidation fan-out.

## Ownership and keys

All definitions live in `src/components/jarvis/lib/projection-definitions.ts`. Keys are serialized tuples and exist only inside the current authenticated session boundary.

| Key family | Owner | Freshness / active cadence | Invalidated by |
| --- | --- | --- | --- |
| `["core","stats"]`, `["actions",filter]` | data-core fast lane | 8–10s | actions, approvals, Work |
| `["workflows",status]` | data-core workflow lane | 8–30s | workflows, Work, receipts |
| `["events","recent"]`, `["comms","recent"]` | data-core medium lane | 30s | events/activity, comms/customer |
| `["read-model",view]` | named surface or data-core slow lane | 15–90s | domain tags (money, schedule, customer, Work, queries) |
| `["read-model","work-cases"]` | Work | 15s | actions, approvals, workflows, receipts, customer, schedule, money, agents |
| `["resources","households"]`, `["read-model","household-360",id]` | Customers | 30–60s | customer, money, schedule, Work, receipts |
| `["resources","invoices"]`, cash collections | Money | 15–20s | money, customer, Work |
| `["schedule","dispatch-map",date]`, technician day | Schedule | 15s | schedule, customer, Work |
| `["system","integrations"]`, Work cases | Agents | 15–180s | agents/system and Work |
| `["activity","latest"]`, `["system","vitals"]` | JARVIS rails | 5–8s | activity/work/system |
| `["operational-query",intent,stableRequest]` | Adaptive Workspace | 30s, invalidation-driven | queries plus the query's business domain |

## Runtime rules

- One `JarvisProviders` stack is mounted by `/jarvis/layout.tsx`, so navigation does not create new auth, cache, data-core, or Vapi islands.
- A cache entry owns one in-flight request. Concurrent readers receive the same promise and increment `requestsDeduped`.
- Every invalidation increments the entry revision. A response begun on an older revision is discarded and cannot overwrite newer truth.
- Cache entries are reset on every session/token boundary. Late responses capture the old cache generation and are ignored. The browser never persists private projection data to local storage.
- Successful writes publish tag invalidations. Action/workflow/dispatch/technician mutations fan out to all affected projections. Decisive instruction SSE phases do the same after asynchronous work reaches a later truth state.
- BroadcastChannel carries tags only, scoped to the authenticated user ID; it never carries business data or bearer tokens. The receiving tab still reads through its own token and backend RLS.
- Hidden tabs cancel projection timers. Invalidation while hidden marks data stale without fetching. Visibility restoration refreshes only subscribed stale entries.
- Offline mode retains the last verified response, marks refresh state truthfully, and performs no speculative writes. `online` reconnect refreshes active entries; failed refreshes retain data with `status: error` and `stale: true`.

## Measurement

`window.__JARVIS_PROJECTION_METRICS__` exposes aggregate, non-sensitive client metrics:

- requests started/completed/failed and requests deduplicated;
- invalidated entries and stale reads;
- stale responses discarded by revision control;
- reconnect count;
- last and cumulative refresh latency.

The same snapshot is emitted as `jarvis:projection-metrics`. Existing `onJarvisRequest` telemetry remains the actual HTTP request ledger, so logical refreshes can be compared with network calls.
