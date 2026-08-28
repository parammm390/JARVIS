# Product Truth closure audit

Audit date: 2026-08-26 (Asia/Kolkata)

This is the commit-locked audit for the P0 closure branch. It records the state that
was observed before the closure changes and the source seams that the changes cover.

## Repository and production baseline

| Item | Observed value |
| --- | --- |
| `BASELINE_SHA` | `afb3e6e013b8f23fc976f7bf934a195781c25390` |
| Branch used for the closure | `codex/product-truth-closure` |
| Production frontend SHA | `afb3e6e013b8f23fc976f7bf934a195781c25390` (Vercel deployment `dpl_jQEcvGFhTiXge9reyCLa3i8ECbpk`) |
| Production API SHA | `afb3e6e013b8f23fc976f7bf934a195781c25390` (Vercel deployment `dpl_9oNk...`) |
| Production migration head | `0101_multi_employee_conversation_context_kernel.sql` |
| Worker release observed | heartbeat reported the baseline SHA; one worker was healthy, with no SSE gateway capability/public ingress |
| Production `/api/ready` | database healthy, migration head above, worker fleet size 1, required secrets healthy |
| Production operational stream | authenticated `https://finnorai.com/api/jarvis/operational-stream` returned `503 BLOCKED-CONFIG` |
| Production frontend realtime configuration | `JARVIS_SSE_GATEWAY_URL` absent; legacy `NEXT_PUBLIC_JARVIS_SSE_URL` present |
| Existing operational delta history | 165 tenant-scoped deltas were present during the audit |

The production state above is intentionally not called a release pass. The closure
branch adds migration `0102_product_truth_objective_realtime.sql` and a release-time
Azure DNS/HTTPS gateway configuration step; the authenticated deployed certifier is
guarded to run only against the exact canonical production SHA after deployment.

## Instruction entrypoints

Before the closure there were four product submission surfaces, each with its own
response interpretation:

1. `src/components/jarvis/kernel/instruction.ts` (main Thread/kernel, including text and voice continuation).
2. `src/components/jarvis/lib/CommandPaletteV2.tsx` (Command Palette instruct mode).
3. `src/components/jarvis/views.tsx` (legacy operational view helper and Research view).
4. `src/lib/jarvis-client.ts` as the shared transport boundary.

After the closure, all four call `jarvisClient.submitInstruction()`, whose return type
is the shared `InstructionSubmissionResult` from
`finnor-os/packages/shared-types/src/instruction-submission.ts`; the only HTTP write
surface is `POST /api/actions`. Approval, cancellation, and Objective controls remain
their existing canonical endpoints and are not alternate instruction submitters.

## Restore and projection paths

The audited restore paths are:

- fresh handoff after `POST /api/actions`;
- active Work operational-delta invalidation and bounded polling;
- refresh pointer restore (`instructions/:id`, `works/:id`, and the Work-case read model);
- recent-thread open (`threads/:id` and its linked Work);
- realtime reconnect/resync;
- degraded transport polling.

They now all apply `src/components/jarvis/kernel/work-projector.ts`. Instruction trace
events own only the received/context/planning/handoff interval; after canonical Work is
observed, the Work-case projection owns the visible execution state.

## Canonical mutation coverage

Migration `0102_product_truth_objective_realtime.sql` covers Objective loops, Objective
steps, planner attempts, event waits, wake claims, BusinessEffects, workflow steps,
approval requests, and approval request steps. Direct Work-bearing tables use the
existing tenant-ordered delta function; indirect sources resolve `work_id` through
their immutable Objective/action/workflow/approval relationship. Deltas carry tenant,
cursor, entity reference, Work ID where resolvable, priority, and invalidation tags.

## Release and certification jobs

- `.github/workflows/ci.yml` runs generated-contract, typecheck, migration, integration,
  full backend, and restore-drill gates on pull requests.
- `.github/workflows/production-release.yml` remains the only production mutation path
  and is still `main`-only/dispatch guarded. It now configures the canonical Azure SSE
  ingress, verifies runtime parity, and runs
  `scripts/release/certify-product-truth-deployed.mjs` with a real tenant JWT after
  frontend/API/worker deployment and migration parity.
- `scripts/release/verify-jarvis-realtime-release.mjs` remains a source/preflight check;
  it is not used as deployed certification.
