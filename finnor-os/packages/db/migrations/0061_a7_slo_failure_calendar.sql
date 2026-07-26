-- A7: broaden the durable failure-injection journal to cover the planned drills.
-- The table is the record of a drill outcome, not a promise that a disruptive drill
-- was run. Every row remains tenant-scoped and RLS-protected by migration 0033.
ALTER TABLE finnor_os.failure_injections
  DROP CONSTRAINT IF EXISTS failure_injections_kind_check;
ALTER TABLE finnor_os.failure_injections
  ADD CONSTRAINT failure_injections_kind_check CHECK (kind IN (
    'worker_kill', 'webhook_replay', 'provider_egress_block',
    'approval_expiry_pileup', 'secrets_store_hiccup', 'deploy_mid_workflow',
    'restore_drill', 'secrets_boot', 'pooling_load'
  ));
