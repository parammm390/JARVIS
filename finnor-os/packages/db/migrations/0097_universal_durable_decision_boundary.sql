-- Phase 2 Universal Durable Decision Boundary. Extends the existing command/step/job
-- runtime; it intentionally creates no second queue, action, approval, or operation
-- abstraction. Business Effects remain the immutable semantic WHAT.

ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS authorized_effect_hash text;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS authority_decision_id uuid;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS authority_revision integer;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS policy_id uuid;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS policy_version integer;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS execution_class text;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS authorized_at timestamptz;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz;

ALTER TABLE finnor_os.commands DROP CONSTRAINT IF EXISTS commands_status_check;
ALTER TABLE finnor_os.commands ADD CONSTRAINT commands_status_check
  CHECK (status IN ('approved','running','completed','failed','cancelled'));
ALTER TABLE finnor_os.commands ADD CONSTRAINT commands_authorized_effect_hash_check
  CHECK (authorized_effect_hash IS NULL OR authorized_effect_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS execution_state text NOT NULL DEFAULT 'authorized';
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS effect_commit_at timestamptz;
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz;
ALTER TABLE finnor_os.workflow_steps ADD CONSTRAINT workflow_steps_execution_state_check CHECK (execution_state IN (
  'authorized','claimed','commit_started','awaiting_observation','reconciling','verified',
  'failed_before_effect','failed_after_possible_effect','cancelled_before_effect',
  'cancellation_requested','blocked'
));

-- Tenant-consistent references close the "known UUID from another tenant" path even
-- for database roles that own tables and can bypass RLS.
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='authority_decisions_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.authority_decisions ADD CONSTRAINT authority_decisions_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='domain_policies_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.domain_policies ADD CONSTRAINT domain_policies_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commands_authority_decision_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.commands ADD CONSTRAINT commands_authority_decision_tenant_fkey
      FOREIGN KEY (tenant_id,authority_decision_id) REFERENCES finnor_os.authority_decisions(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='commands_policy_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.commands ADD CONSTRAINT commands_policy_tenant_fkey
      FOREIGN KEY (tenant_id,policy_id) REFERENCES finnor_os.domain_policies(tenant_id,id);
  END IF;
END $constraints$;

CREATE INDEX IF NOT EXISTS commands_tenant_effect_state_idx
  ON finnor_os.commands(tenant_id,business_effect_id,status);
CREATE INDEX IF NOT EXISTS workflow_steps_tenant_execution_state_idx
  ON finnor_os.workflow_steps(tenant_id,execution_state,lease_expires_at);

COMMENT ON COLUMN finnor_os.workflow_steps.execution_state IS
  'Durable effect-boundary state, separate from local queue/lease delivery status.';
COMMENT ON COLUMN finnor_os.workflow_steps.effect_commit_at IS
  'Timestamp at which a consequential request or mutation may begin; after this point cancellation requires observation/reconciliation.';
