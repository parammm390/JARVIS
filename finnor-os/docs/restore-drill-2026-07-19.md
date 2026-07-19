# Restore drill — 2026-07-19 (Phase 6, Task 6.3)

## What this is, honestly

`docs/backup-restore-runbook.md` already documents `scripts/backup-restore-drill.ts` as
a real, ready-to-run dump/restore round-trip, blocked purely on Postgres client tools
(`pg_dump`/`pg_restore`/`createdb`/`dropdb`) not being present in this sandboxed
development environment (`which pg_dump` etc. all return nothing here — re-confirmed
this session, unchanged from the prior finding).

This session's real, committed change: `.github/workflows/ci.yml` now installs
`postgresql-client` via `apt-get` and runs `npx tsx scripts/backup-restore-drill.ts` as
a CI step, immediately after `npm test`, against the same real Postgres service
container CI already runs the integration suite against. `ubuntu-latest` GitHub runners
do not ship `pg_dump`/`pg_restore` by default — the added `apt-get install
postgresql-client` step is what actually provides them.

## What is NOT proven yet, stated plainly

**I cannot verify this CI step actually goes green.** `git push origin main` fails from
this environment (`could not read Username for 'https://github.com'` — no credential
helper configured, a pre-existing blocker logged in `owner-actions.md` §2 since Phase
1). Production deploys bypass this entirely (`vercel deploy --prod` builds from the
local tree directly), which is why the site has stayed current despite this gap — but
it also means **this CI workflow change cannot run on GitHub Actions until someone with
push access runs it**, so "the restore drill passed in CI" is not yet a fact, only a
correctly-written, locally-reviewed step waiting for its first real execution.

Once `git push` works (owner action, `owner-actions.md` §2) and this commit reaches
GitHub: the very next push or PI touching `finnor-os/**` will trigger `finnor-os-ci` and
run the drill for real. Whoever watches that first run should update this doc with the
actual pass/fail outcome and, if it fails (e.g. a `postgresql-client` version mismatch
against the `pgvector/pgvector:pg16` service image), fix it and note the fix here per
the pack's own rule ("when reality diverges from a runbook, fix the runbook in the same
commit").

## What this satisfies vs. what it doesn't

- Satisfies: `docs/backup-restore-runbook.md`'s own "Local / CI mechanics" tier — the
  actual dump/restore/row-count-compare/cleanup round-trip, proven the moment it first
  runs green in CI.
- Does NOT satisfy: the pack's Task 6.3 "restore latest prod backup into an isolated
  env" — that requires a **second, real Supabase project** to restore into (an account
  Param has to create; see `owner-actions.md`'s new Phase 6 section). This CI addition
  is real, necessary groundwork for that, not a substitute for it.
- Does NOT satisfy: the weekly-automated-restore-verification half of Task 6.3 — that
  depends on the same second Supabase project existing first.

## Next step once unblocked

1. Fix `git push` (owner-actions.md §2) — trivial, `gh auth login`.
2. Watch the first `finnor-os-ci` run touching this commit; confirm the restore-drill
   step passes; update this doc with the real timing/output.
3. Once a staging Supabase project exists (Phase 6's own §6.1, also owner-blocked):
   extend this same script to target it for the full production-parity drill, and stand
   up the weekly automated-restore-verification job Task 6.3 asks for.
