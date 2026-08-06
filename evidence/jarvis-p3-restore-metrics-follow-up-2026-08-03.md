# P3 restore, trace-key, and responsive follow-up — 2026-08-03

## Scope

This follow-up rechecked the canonical `/jarvis` owner surface after fixing a
concrete diagnostic-key mismatch. The kernel queue uses a local Thread id for
state updates, while the rendered Thread reads the trace-paint bus by
`instructionId`; the restore and streamed/polled receipt paths now pass the
instruction id to `recordTraceEventReceived` and retain the local Thread id
only for queue correlation.

The check did not submit an instruction, answer the clarification, approve or
reject an action, retry a run, apply a production migration, or perform an
external workflow action.

## Source and focused verification

- `src/components/jarvis/kernel/store.tsx` now keeps `threadId` and
  `instructionId` explicit in `enqueueTraceEvents`; restore records fetched
  rows under `pointer.instructionId`.
- `npx vitest run src/components/jarvis/kernel/trace-metrics.test.ts
  src/components/jarvis/kernel/apply-trace-events.test.ts
  src/components/jarvis/bridge/ThreadStack.test.ts --reporter=dot` passed
  **3 files / 34 tests**.
- Scoped ESLint for `store.tsx` passed.
- `git diff --check` passed.
- The root `npx tsc --noEmit --pretty false` remains an inconclusive bounded
  check in this worktree; it was not counted as a pass. Vercel's production
  build completed its own type/lint stage successfully.

## Production deployment

- Deployment: `dpl_4PJBSD9gE37dPnPcF4r5HWnsNTDW`
- Target/status: production / `READY`
- Canonical alias: `https://finnorai.com/jarvis`
- Build generated all 38 static pages and completed successfully.
- The build repeated existing non-fatal Sentry ESM and edge-runtime static
  generation warnings; no new build failure was observed.

## Authenticated owner-tab result

The existing authenticated Chrome owner tab was reloaded at the canonical
route with a cache-busting audit query. The browser reported:

| Observation | Result |
|---|---|
| viewport | `1470 × 779` |
| document width | `1462` (`< 1470`, no horizontal overflow) |
| scroll position | `0` |
| `data-thread-restored` | `true` |
| instruction id | `c9916f23-0d62-4b3c-acc0-18a85ef62c79` |
| restored event rows | `7` |
| rendered trace measurements | `7` |
| active focus | `householdId` clarification input |
| visible live state | Heard → Understood → Clarify for the real water-test instruction |

All three restored Thread entries were marked `data-thread-block-entry="settled"`;
Heard and Understood were collapsed, Plan was the active block, and the
clarification input retained focus.

The seven browser-receipt → next-paint measurements were:

```text
seq  phase                   stage       event→pixel ms
1    received                heard             56.400000
2    context_retrieved       understood        56.400000
3    planning                understood        56.300000
4    plan_ready              plan              56.300000
5    action_created          plan              56.300000
6    clarification_required  plan              56.300000
7    action_gated            plan              56.300000
```

Observed summary: count **7**, median **56.300000 ms**, nearest-rank p95
**56.400000 ms**, min **56.300000 ms**, max **56.400000 ms**. These timestamps
start at the browser's local authenticated fetch/application boundary and end
at the next rendered frame. They are truthful browser receipt→paint values;
they are **not** backend event-creation latency and do not by themselves prove
the separate SSE/poll transport-class targets in Plan §5.4.

## Responsive live check result

`e2e/jarvis-p3-live-restore-responsive.spec.ts` attempted a bounded authenticated
restore-only check at 1440px and 390px against the same supplied instruction id.
It never submitted, answered, approved, rejected, retried, or called an
external action. The repository's dedicated test account received:

```text
404 /api/jarvis/instructions/c9916f23-0d62-4b3c-acc0-18a85ef62c79
```

The page remained at the authenticated Ready shell and rendered no Thread
document, so the test failed before either responsive snapshot. This is a
session/tenant-scope boundary for that supplied owner-tab id, not evidence that
the instruction is absent from the owner Chrome session. It is not counted as
1440px or 390px live proof.

## Gate consequence

The live same-owner refresh/restore result now supports the refresh/no-replayed-
bloom gate at the observed 1470px owner surface. The following remain open:

- complete live ready→captured→understanding→planning→clarifying/approval→
  executing→verifying→terminal lifecycle plus retry;
- live transition CLS/layout-shift trace and the exact 1440/390 recording;
- separate SSE/poll transport timing evidence for context/plan edges;
- an authoritative Plan-defined or reviewer score artifact for ≥87/100.

No Phase 3 completion or score movement is claimed.

## Final bounded local-runtime attempt

To replace the earlier “no serving port” uncertainty, a fresh local PostgreSQL
18.4 instance was started on 5432, the existing migrations were already present,
and `npm run db:seed` completed for tenant
`00000000-0000-4000-8000-000000000001`. The API was started with
`NODE_ENV=development AUTH_DEV_BYPASS=1` and the local database URL; Next
reported `http://localhost:3100` and port 3100 was listening.

Authenticated dev-bypass requests carrying the seeded tenant/user headers then
received no response bytes: `/api/health` timed out at 5 seconds and again at
10 seconds. The API and PostgreSQL processes were stopped cleanly. This proves
only that the API listener bound before its route became responsive; it is not
counted as a usable local authenticated runtime or as live lifecycle evidence.
