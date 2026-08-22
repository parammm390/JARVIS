/** Read-only production recovery preflight. It never starts a restore and never
 * prints credentials/connection strings. A real isolated restore remains Phase 6. */

type BackupEnvelope = {
  pitr_enabled?: boolean;
  walg_enabled?: boolean;
  backups?: Array<{ id?: number; status?: string; inserted_at?: string; is_physical_backup?: boolean }>;
  physical_backup_data?: { earliest_physical_backup_date_unix?: number; latest_physical_backup_date_unix?: number };
};

type Verdict = "PASS" | "FAIL" | "BLOCKED-CONFIG";

async function main(): Promise<void> {
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  const isolatedTargetConfigured = Boolean(process.env.FINNOR_RESTORE_TARGET_DATABASE_URL?.trim());
  const missing = [
    ...(!projectRef ? ["SUPABASE_PROJECT_REF"] : []),
    ...(!accessToken ? ["SUPABASE_ACCESS_TOKEN"] : []),
    ...(!isolatedTargetConfigured ? ["FINNOR_RESTORE_TARGET_DATABASE_URL"] : []),
  ];
  if (missing.length > 0) {
    console.log(JSON.stringify({ schema: "finnor.recovery-preflight/v1", verdict: "BLOCKED-CONFIG" satisfies Verdict, missing, destructiveActionStarted: false }, null, 2));
    process.exitCode = 2;
    return;
  }

  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef!)}/database/backups`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    console.log(JSON.stringify({ schema: "finnor.recovery-preflight/v1", verdict: "FAIL" satisfies Verdict, reason: `Supabase backup inventory returned HTTP ${response.status}`, destructiveActionStarted: false }, null, 2));
    process.exitCode = 1;
    return;
  }
  const body = await response.json() as BackupEnvelope;
  const completed = (body.backups ?? []).filter((backup) => backup.status === "COMPLETED");
  const newest = completed.map((backup) => backup.inserted_at).filter((value): value is string => typeof value === "string").sort().at(-1) ?? null;
  const recoverable = body.pitr_enabled === true || completed.length > 0;
  console.log(JSON.stringify({
    schema: "finnor.recovery-preflight/v1",
    verdict: (recoverable ? "PASS" : "FAIL") satisfies Verdict,
    provider: "supabase",
    pitrEnabled: body.pitr_enabled === true,
    walArchivingEnabled: body.walg_enabled === true,
    completedBackupCount: completed.length,
    newestCompletedBackupAt: newest,
    earliestPhysicalRecoveryUnix: body.physical_backup_data?.earliest_physical_backup_date_unix ?? null,
    latestPhysicalRecoveryUnix: body.physical_backup_data?.latest_physical_backup_date_unix ?? null,
    isolatedRestoreTargetConfigured: isolatedTargetConfigured,
    externalObjectBackupIncluded: false,
    rpoDemonstrated: false,
    rtoDemonstrated: false,
    destructiveActionStarted: false,
    nextPhase: "Phase 6 must execute and time an isolated restore, validate RLS/data/contracts, and reconfigure non-database dependencies.",
  }, null, 2));
  if (!recoverable) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ schema: "finnor.recovery-preflight/v1", verdict: "FAIL", reason: error instanceof Error ? error.message : "Recovery preflight failed", destructiveActionStarted: false }, null, 2));
  process.exit(1);
});
