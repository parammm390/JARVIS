# P3 runtime-boundary follow-up — 2026-08-03

Scope is `/jarvis` only. This record captures the local migrated-backend check,
the authorized production deployment, and the current authenticated owner-tab
observation. It does not assign a score or close a Phase 3 gate.

## Local backend checks

- A direct local PostgreSQL 18.4 process was started on `localhost:5432` using
  the existing `finnor-os/.devdb` directory. No database files were removed.
- `DATABASE_URL=postgres://finnor:finnor@localhost:5432/finnor npm run db:migrate`
  applied `0062_instruction_lifecycle.sql` and
  `0063_repair_orphaned_completed_runs`.
- The same migration command was rerun and returned `Already up to date`.
- `DATABASE_URL=postgres://finnor:finnor@localhost:5432/finnor npx vitest run
  tests/integration/instructions-routes.test.ts --reporter=dot` passed one file
  and **6/6 tests** in **92.37 s**.
- `finnor-os` `npm run typecheck` was bounded and stopped with exit **130**
  after no verdict; it is not counted as passing.
- The local API `next dev -p 3100` attempts (workspace and direct app forms)
  produced no serving port or verdict during the bounded waits and were stopped
  with Ctrl-C; no local live API surface is claimed.

The local migration and route-integration result verifies the checked-out
backend route contract only. It does not prove that production migration 0062
has been applied.

## Source and deployment checks

- `src/components/jarvis/bridge/Thread.tsx` now exposes the existing exact
  `thread.instructionId` as the non-visual
  `data-jarvis-instruction-id` diagnostic attribute. The attribute is not read
  by product logic or customer-facing copy.
- Root TypeScript, the changed-source ESLint command, and `git diff --check`
  all exited **0** after the seam was added.
- `npx vercel --prod --yes` completed successfully. Vercel deployment
  `dpl_44z9rgN2CxEvJVzitBvuVCXDsuEQ` is **READY** in Production and is aliased
  to `https://finnorai.com`.
- The build reported the existing Sentry ESM warning and edge-runtime static
  generation warning. These are recorded warnings, not evidence of a P3 gate.

## Authenticated owner-tab observation

The existing Chrome owner tab at `https://finnorai.com/jarvis` was claimed and
read after the current deployment. The browser surface was **1470 × 779 CSS
pixels**; no viewport-resize API was available, so this is not a 1440/390
responsive recording.

Observed DOM facts:

- visible primary copy: `Needs one detail`;
- the same live instruction remained visible:
  `Book a water test for the Hendersons this week and give it to whoever's closest`;
- `data-thread-restored="true"`;
- `data-jarvis-instruction-id="c9916f23-0d62-4b3c-acc0-18a85ef62c79"`;
- the restored document contained Heard, Understood, and Clarify blocks, with
  the plan/clarification block active;
- focus was the clarification input with `aria-label="householdId"` and
  `placeholder="householdId"`;
- `document.documentElement.scrollWidth` was **1462**, below the
  `innerWidth` of **1470**, so no horizontal overflow was observed;
- `data-jarvis-trace-metrics-count="0"` and no trace-metrics payload was
  present. No live event-receipt→paint timing is claimed.

This is stronger live mid-flight restore evidence than the earlier empty-shell
refresh, but it is one 1470px owner-tab observation. It does not establish the
required 1440/390 recording, complete separately timestamped lifecycle, live
CLS, live event→pixel timing, or retry proof.

## Tenant boundary and safety

- The owner instruction ID above was queried through the separately configured
  service-account API probe. Both the instruction and event endpoints returned
  `404 Instruction not found`. Because that token is not the browser owner
  session, this probe is insufficient to infer that the owner record is absent;
  it is not counted as live trace failure or live trace proof.
- The service-account pending/audit reads returned older clarification rows with
  null `instructionId` values; they were not used as evidence for the current
  owner thread.
- No production migration was applied. No approval control or known external
  workflow control was clicked, and no external side effect is inferred.

## Gate consequence

The new deployment and owner-tab observation are recorded as supporting
evidence. The inspection seam still reports no live event-receipt metrics, and
the required 390px/live timing/CLS/complete lifecycle/retry and authoritative
score proofs remain open. P3 remains **2/7 supported**, the evidence-backed
score remains **10/100**, phases complete remains **0/6**, and no Phase 3
completion claim is made.

At the end of this check, the temporary local PostgreSQL listener was stopped;
the existing `.devdb` directory was retained.
