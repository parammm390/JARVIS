# Production backup and recovery contract

This document records what FINNOR can prove, not what a provider plan might offer.

## Current architecture

- The canonical database is PostgreSQL on Supabase.
- The worker has a supplementary logical backup job. It serializes `finnor_os`
  tables, gzips the artifact, and uploads it to a configured private GitHub Releases
  repository every six hours.
- That worker backup is `BLOCKED-CONFIG` unless `BACKUP_GITHUB_TOKEN` and
  `BACKUP_GITHUB_REPO` are present. Scheduling alone is not proof that a successful
  backup exists.
- Supabase physical backups/PITR are authoritative only after the read-only Management
  API preflight verifies the production project.

Run the safe preflight:

```bash
npm run recovery:preflight
```

It requires `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, and an isolated
`FINNOR_RESTORE_TARGET_DATABASE_URL`. It lists backup capability and available restore
points but never starts a restore. Missing legitimate configuration is reported as
`BLOCKED-CONFIG`, never PASS.

## RPO and RTO

FINNOR does not currently claim a demonstrated production RPO or RTO. A six-hour
scheduler interval is not an RPO, and a small local restore duration is not a
production RTO. Phase 6 must measure both using the actual production backup source,
production-scale data, an isolated restore target, and the full traffic/configuration
cutover procedure.

## Restore procedure

1. Freeze or divert writes and record the incident, release, and migration identifiers.
2. Use Supabase Database Backups to select a completed backup or valid PITR point.
3. Restore to a new/isolated project for a drill. Never test by overwriting production.
4. Reapply non-database configuration: Auth settings/API keys, Realtime settings,
   extensions, network restrictions, worker/API/console environment, and managed
   secret access. Database backups do not restore Storage object bytes.
5. Verify migration head, tenant RLS with the non-owner application role, cross-tenant
   rejection, append-only audit triggers, queue leases, release parity, and critical
   P0–P5 journeys.
6. Only after validation, perform an authorized connection/traffic cutover. Record the
   measured restore and cutover times.

Supabase in-place restore causes downtime and can lose writes after the selected point;
it is an incident action requiring explicit human authorization. The Phase 5 preflight
does not call the restore endpoint.

## Supplementary GitHub backup drill

`npx tsx scripts/restore-drill-from-backup.ts` downloads the latest configured worker
backup, restores it to a throwaway PostgreSQL database, migrates it, runs structural
smoke checks, and drops the throwaway database. It is useful preparation, but does not
prove Supabase PITR, external object recovery, production-scale timing, or cutover.

## Migration rollback posture

Migration `0090_phase5_production_connection_reliability.sql` is additive and supports
old workers during a rolling rollout. Once Phase 5 writes new connection/lease state,
the database migration is not rolled back destructively. Application regressions use
an application rollback only when the compatibility check passes; schema defects use a
forward fix. Never delete migration history or drop Phase 5 columns during an incident.
