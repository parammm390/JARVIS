# Backup & Restore Runbook

## Local / CI mechanics

`scripts/backup-restore-drill.ts` proves the actual dump/restore round-trip works:

```bash
npx tsx scripts/backup-restore-drill.ts
```

It dumps the `finnor_os` schema (`pg_dump -Fc -n finnor_os`), restores it into a throwaway database (`finnor_restore_drill_<timestamp>`), compares row counts on a handful of core tables (`tenants`, `domain_actions`, `households`, `action_log`) between source and restored copies, and drops the throwaway database when done — pass or fail.

**Requires PostgreSQL client tools** (`pg_dump`, `pg_restore`, `createdb`, `dropdb`) on `PATH`. A normal dev machine (Postgres.app, `brew install postgresql`, or `apt install postgresql-client`) has these. This repo's sandboxed `embedded-postgres` dev database (`.devdb`) ships **server binaries only** (`postgres`, `initdb`, `pg_ctl`) — no client tools — so the drill script cannot run inside that specific setup. Run it from a machine with real Postgres client tools installed, pointed at `DATABASE_URL`.

## Production (Supabase)

Production backups are **not** this script — Supabase manages backups differently:

- **Automated backups**: Supabase takes daily backups automatically on paid tiers, with point-in-time recovery (PITR) available on Pro tier and above. Check Project Settings → Database → Backups for the current retention window.
- **Manual backup**: `supabase db dump` (Supabase CLI) or `pg_dump` directly against the connection string from Project Settings → Database, same flags as the drill script above (`-Fc -n finnor_os` — this schema is deliberately isolated from the rest of the Supabase project's `public` schema, so a scoped dump only touches Finnor's own tables).
- **Restore drills in production**: **never restore into the live project.** Create a **separate** Supabase project (or a local instance) and restore there — the same pattern the local drill script follows (throwaway database, never the source). Verify row counts / spot-check a few tables, then tear the restore target down.
- **PITR restore**: handled entirely through the Supabase dashboard (Database → Backups → Point in Time Recovery) — this creates a new project from a timestamp, it does not modify the live project in place.

## Last drill attempt (Phase 16b, 2026-07-18)

Attempted to run `scripts/backup-restore-drill.ts` for real against the dev database
from this session's sandboxed environment. Result: **still blocked on client tools —
honestly, not run.** What was checked before concluding that:

- `which pg_dump pg_restore createdb dropdb` — none present on `PATH`.
- No `brew`, no `docker`, no `conda` available in this environment (all three absent).
- The project's own `@embedded-postgres/darwin-arm64` package (already a devDependency)
  was inspected directly — `node_modules/@embedded-postgres/darwin-arm64/native/bin/`
  contains exactly `initdb`, `pg_ctl`, `postgres`. No client tools, confirming this
  doc's existing claim rather than just repeating it.
- Searched the npm registry and PyPI for a portable, prebuilt `pg_dump`/`pg_restore`
  binary distribution installable without a package manager or container — found
  nothing that ships the actual CLI tools (only libpq bindings, ORMs, or unrelated
  packages).
- A filesystem-wide search for a pre-existing `pg_dump` binary (Postgres.app,
  `/usr/local`, `/opt/homebrew`) also came up empty.

**Conclusion: the drill remains human-blocked on Postgres client tools**, exactly the
condition this doc already described. Nothing beyond that condition has changed. The
correct next step is still: run `npx tsx scripts/backup-restore-drill.ts` from a real
development machine or CI image with `postgresql-client` installed (`brew install
postgresql`, `apt install postgresql-client`, or a CI image that already has it) — the
script itself is unchanged and ready to execute the moment client tools are present.

## What to verify after any real restore

1. Row counts on `tenants`, `domain_actions`, `action_log`, `domain_policies` roughly match expectations for the restore point.
2. `action_log`'s append-only constraint (`UPDATE`/`DELETE` rejected by the DB trigger) still holds — a raw dump/restore preserves table definitions including triggers, but verify with the existing test (`tests/integration/full-flow.test.ts`'s "action_log immutability" case) against the restored instance if this is anything beyond a routine drill.
3. RLS policies are present and enforced (`tests/integration/tenant-isolation.test.ts` against the restored instance, non-superuser role).
