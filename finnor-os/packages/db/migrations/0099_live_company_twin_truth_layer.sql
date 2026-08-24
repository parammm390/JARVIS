-- Phase 4 Live Company Digital Twin + Production Connector Truth Layer.
--
-- This migration extends the existing integration registry, external object join,
-- durable operation ledger, and reconciliation cases. It deliberately does not add
-- another canonical graph, queue, webhook fabric, credential store, or event bus.

ALTER TABLE finnor_os.tenant_integrations
  ADD COLUMN IF NOT EXISTS application_account_id uuid,
  ADD COLUMN IF NOT EXISTS auth_profile_id uuid,
  ADD COLUMN IF NOT EXISTS source_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS freshness_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sync_scopes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS outcome_packs text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'uninitialized',
  ADD COLUMN IF NOT EXISTS freshness_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS webhook_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS reconciliation_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sync_initialized_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_lag_ms bigint,
  ADD COLUMN IF NOT EXISTS unresolved_conflicts integer NOT NULL DEFAULT 0;

-- Provider acknowledgement is a durable non-terminal step state. Keep the SQL
-- constraint aligned with the runtime/schema contract or production would reject
-- the exact point where execution begins waiting for external truth.
ALTER TABLE finnor_os.workflow_steps DROP CONSTRAINT IF EXISTS workflow_steps_status_check;
ALTER TABLE finnor_os.workflow_steps ADD CONSTRAINT workflow_steps_status_check CHECK (
  status IN ('pending','leased','waiting_observation','completed','failed','compensating','compensated')
);

ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_sync_status_check,
  ADD CONSTRAINT tenant_integrations_sync_status_check CHECK (
    sync_status IN ('uninitialized','initializing','syncing','synced','degraded','blocked')
  ),
  DROP CONSTRAINT IF EXISTS tenant_integrations_freshness_state_check,
  ADD CONSTRAINT tenant_integrations_freshness_state_check CHECK (
    freshness_state IN ('unknown','fresh','stale','expired')
  ),
  DROP CONSTRAINT IF EXISTS tenant_integrations_webhook_status_check,
  ADD CONSTRAINT tenant_integrations_webhook_status_check CHECK (
    webhook_status IN ('unknown','healthy','degraded','disabled')
  ),
  DROP CONSTRAINT IF EXISTS tenant_integrations_reconciliation_status_check,
  ADD CONSTRAINT tenant_integrations_reconciliation_status_check CHECK (
    reconciliation_status IN ('unknown','healthy','degraded','blocked')
  ),
  DROP CONSTRAINT IF EXISTS tenant_integrations_source_policy_object_check,
  ADD CONSTRAINT tenant_integrations_source_policy_object_check CHECK (jsonb_typeof(source_policy)='object'),
  DROP CONSTRAINT IF EXISTS tenant_integrations_freshness_policy_object_check,
  ADD CONSTRAINT tenant_integrations_freshness_policy_object_check CHECK (jsonb_typeof(freshness_policy)='object'),
  DROP CONSTRAINT IF EXISTS tenant_integrations_source_lag_nonnegative_check,
  ADD CONSTRAINT tenant_integrations_source_lag_nonnegative_check CHECK (source_lag_ms IS NULL OR source_lag_ms>=0),
  DROP CONSTRAINT IF EXISTS tenant_integrations_unresolved_conflicts_nonnegative_check,
  ADD CONSTRAINT tenant_integrations_unresolved_conflicts_nonnegative_check CHECK (unresolved_conflicts>=0);

DO $integration_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_integrations_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tenant_integrations ADD CONSTRAINT tenant_integrations_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_integrations_application_account_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tenant_integrations ADD CONSTRAINT tenant_integrations_application_account_tenant_fkey
      FOREIGN KEY (tenant_id,application_account_id) REFERENCES finnor_os.application_accounts(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_integrations_auth_profile_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tenant_integrations ADD CONSTRAINT tenant_integrations_auth_profile_tenant_fkey
      FOREIGN KEY (tenant_id,auth_profile_id) REFERENCES finnor_os.auth_profiles(tenant_id,id);
  END IF;
END $integration_fks$;

CREATE INDEX IF NOT EXISTS tenant_integrations_truth_health_idx
  ON finnor_os.tenant_integrations(tenant_id,sync_status,freshness_state,reconciliation_status);

-- One durable cursor/checkpoint per configured tenant/account/source scope. Jobs,
-- leases, retries, and DLQ remain in the existing worker queue; this row only stores
-- provider pagination/delta progress so restart cannot duplicate or skip a page.
CREATE TABLE IF NOT EXISTS finnor_os.integration_sync_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  integration_id uuid NOT NULL,
  source_scope text NOT NULL,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor_version integer NOT NULL DEFAULT 1,
  high_watermark timestamptz,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','degraded','blocked')),
  lease_owner text,
  lease_expires_at timestamptz,
  last_page_at timestamptz,
  last_success_at timestamptz,
  error_code text,
  recovery jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_sync_checkpoints_identity_unique UNIQUE (tenant_id,integration_id,source_scope),
  CONSTRAINT integration_sync_checkpoints_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT integration_sync_checkpoints_integration_tenant_fkey
    FOREIGN KEY (tenant_id,integration_id) REFERENCES finnor_os.tenant_integrations(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT integration_sync_checkpoints_scope_check CHECK (btrim(source_scope)<>'' AND length(source_scope)<=160),
  CONSTRAINT integration_sync_checkpoints_cursor_object_check CHECK (jsonb_typeof(cursor)='object'),
  CONSTRAINT integration_sync_checkpoints_recovery_object_check CHECK (jsonb_typeof(recovery)='object'),
  CONSTRAINT integration_sync_checkpoints_cursor_version_check CHECK (cursor_version>=1),
  CONSTRAINT integration_sync_checkpoints_lease_pair_check CHECK ((lease_owner IS NULL)=(lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS integration_sync_checkpoints_due_idx
  ON finnor_os.integration_sync_checkpoints(tenant_id,status,lease_expires_at,updated_at);

-- `external_refs` was already the documented single join between canonical objects
-- and provider objects. Expand that exact seam into the source link; do not scatter
-- provider ids or create a competing mapping graph.
ALTER TABLE finnor_os.external_refs
  ALTER COLUMN internal_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS integration_id uuid,
  ADD COLUMN IF NOT EXISTS external_object_type text,
  ADD COLUMN IF NOT EXISTS mapping_status text NOT NULL DEFAULT 'mapped',
  ADD COLUMN IF NOT EXISTS identity_key text,
  ADD COLUMN IF NOT EXISTS candidate_canonical_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS source_version text,
  ADD COLUMN IF NOT EXISTS source_sequence bigint,
  ADD COLUMN IF NOT EXISTS observed_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS observed_hash text,
  ADD COLUMN IF NOT EXISTS canonical_hash text,
  ADD COLUMN IF NOT EXISTS first_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS freshness_state text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'observed',
  ADD COLUMN IF NOT EXISTS conflict_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS ownership_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tombstoned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_effect_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE finnor_os.external_refs SET external_object_type=entity WHERE external_object_type IS NULL;
ALTER TABLE finnor_os.external_refs
  ALTER COLUMN external_object_type SET DEFAULT 'record',
  ALTER COLUMN external_object_type SET NOT NULL;

ALTER TABLE finnor_os.external_refs
  DROP CONSTRAINT IF EXISTS external_refs_mapping_status_check,
  ADD CONSTRAINT external_refs_mapping_status_check CHECK (mapping_status IN ('mapped','unresolved','ambiguous','tombstoned')),
  DROP CONSTRAINT IF EXISTS external_refs_freshness_state_check,
  ADD CONSTRAINT external_refs_freshness_state_check CHECK (freshness_state IN ('unknown','fresh','stale','expired')),
  DROP CONSTRAINT IF EXISTS external_refs_sync_status_check,
  ADD CONSTRAINT external_refs_sync_status_check CHECK (sync_status IN ('acknowledged','observed','materialized','reconciled','conflict','source_missing','failed')),
  DROP CONSTRAINT IF EXISTS external_refs_conflict_state_check,
  ADD CONSTRAINT external_refs_conflict_state_check CHECK (conflict_state IN ('none','canonical_newer','external_newer','divergent','ambiguous','manual_resolution_required')),
  DROP CONSTRAINT IF EXISTS external_refs_mapping_shape_check,
  ADD CONSTRAINT external_refs_mapping_shape_check CHECK (
    (mapping_status='mapped' AND internal_id IS NOT NULL AND cardinality(candidate_canonical_ids)=0)
    OR (mapping_status='unresolved' AND internal_id IS NULL)
    OR (mapping_status='ambiguous' AND internal_id IS NULL AND cardinality(candidate_canonical_ids)>1)
    OR (mapping_status='tombstoned')
  ),
  DROP CONSTRAINT IF EXISTS external_refs_observed_state_object_check,
  ADD CONSTRAINT external_refs_observed_state_object_check CHECK (jsonb_typeof(observed_state)='object' AND octet_length(observed_state::text)<=262144),
  DROP CONSTRAINT IF EXISTS external_refs_ownership_policy_object_check,
  ADD CONSTRAINT external_refs_ownership_policy_object_check CHECK (jsonb_typeof(ownership_policy)='object' AND octet_length(ownership_policy::text)<=32768),
  DROP CONSTRAINT IF EXISTS external_refs_provenance_object_check,
  ADD CONSTRAINT external_refs_provenance_object_check CHECK (jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=65536),
  DROP CONSTRAINT IF EXISTS external_refs_observed_hash_check,
  ADD CONSTRAINT external_refs_observed_hash_check CHECK (observed_hash IS NULL OR observed_hash ~ '^[0-9a-f]{64}$'),
  DROP CONSTRAINT IF EXISTS external_refs_canonical_hash_check,
  ADD CONSTRAINT external_refs_canonical_hash_check CHECK (canonical_hash IS NULL OR canonical_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE finnor_os.external_refs
  DROP CONSTRAINT IF EXISTS external_refs_source_sequence_nonnegative_check,
  ADD CONSTRAINT external_refs_source_sequence_nonnegative_check CHECK (source_sequence IS NULL OR source_sequence>=0);

ALTER TABLE finnor_os.external_refs DROP CONSTRAINT IF EXISTS external_refs_internal_provider_idx;
CREATE UNIQUE INDEX IF NOT EXISTS external_refs_internal_binding_unique
  ON finnor_os.external_refs(tenant_id,entity,internal_id,provider,coalesce(integration_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE internal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS external_refs_external_binding_unique
  ON finnor_os.external_refs(tenant_id,integration_id,external_object_type,external_id)
  WHERE integration_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_refs_truth_status_idx
  ON finnor_os.external_refs(tenant_id,integration_id,mapping_status,freshness_state,conflict_state,last_observed_at);

DO $source_link_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_refs_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.external_refs ADD CONSTRAINT external_refs_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_refs_integration_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.external_refs ADD CONSTRAINT external_refs_integration_tenant_fkey
      FOREIGN KEY (tenant_id,integration_id) REFERENCES finnor_os.tenant_integrations(tenant_id,id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='external_refs_last_effect_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.external_refs ADD CONSTRAINT external_refs_last_effect_tenant_fkey
      FOREIGN KEY (tenant_id,last_effect_id) REFERENCES finnor_os.business_effects(tenant_id,id);
  END IF;
END $source_link_fks$;

ALTER TABLE finnor_os.integration_operations
  ADD COLUMN IF NOT EXISTS integration_id uuid,
  ADD COLUMN IF NOT EXISTS provider_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS observation jsonb;
ALTER TABLE finnor_os.external_operations
  ADD COLUMN IF NOT EXISTS integration_id uuid,
  ADD COLUMN IF NOT EXISTS provider_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS observation jsonb;

DO $operation_checks$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['integration_operations','external_operations'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I DROP CONSTRAINT IF EXISTS %I',table_name,table_name||'_verification_status_check');
    EXECUTE format(
      'ALTER TABLE finnor_os.%I ADD CONSTRAINT %I CHECK (verification_status IN (''not_required'',''awaiting_observation'',''verified'',''divergent'',''unknown''))',
      table_name,table_name||'_verification_status_check'
    );
    EXECUTE format('ALTER TABLE finnor_os.%I DROP CONSTRAINT IF EXISTS %I',table_name,table_name||'_observation_object_check');
    EXECUTE format(
      'ALTER TABLE finnor_os.%I ADD CONSTRAINT %I CHECK (observation IS NULL OR (jsonb_typeof(observation)=''object'' AND octet_length(observation::text)<=131072))',
      table_name,table_name||'_observation_object_check'
    );
  END LOOP;
END $operation_checks$;

DO $operation_fks$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['integration_operations','external_operations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=table_name||'_integration_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
      EXECUTE format(
        'ALTER TABLE finnor_os.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id,integration_id) REFERENCES finnor_os.tenant_integrations(tenant_id,id)',
        table_name,table_name||'_integration_tenant_fkey'
      );
    END IF;
  END LOOP;
END $operation_fks$;

CREATE INDEX IF NOT EXISTS integration_operations_observation_idx
  ON finnor_os.integration_operations(tenant_id,integration_id,verification_status,updated_at);
CREATE INDEX IF NOT EXISTS external_operations_observation_idx
  ON finnor_os.external_operations(tenant_id,integration_id,verification_status,updated_at);

ALTER TABLE finnor_os.reconciliation_cases
  ADD COLUMN IF NOT EXISTS integration_id uuid,
  ADD COLUMN IF NOT EXISTS source_link_id uuid,
  ADD COLUMN IF NOT EXISTS classification text,
  ADD COLUMN IF NOT EXISTS authoritative_side text,
  ADD COLUMN IF NOT EXISTS resolution jsonb;
ALTER TABLE finnor_os.reconciliation_cases DROP CONSTRAINT IF EXISTS reconciliation_cases_case_type_check;
ALTER TABLE finnor_os.reconciliation_cases ADD CONSTRAINT reconciliation_cases_case_type_check CHECK (
  case_type IN ('unknown_delivery','unmatched_inbox_event','external_drift','mapping_ambiguous','stale_source','auth_failure')
);
ALTER TABLE finnor_os.reconciliation_cases ADD CONSTRAINT reconciliation_cases_authoritative_side_check
  CHECK (authoritative_side IS NULL OR authoritative_side IN ('finnor','external','manual'));
ALTER TABLE finnor_os.reconciliation_cases ADD CONSTRAINT reconciliation_cases_resolution_object_check
  CHECK (resolution IS NULL OR (jsonb_typeof(resolution)='object' AND octet_length(resolution::text)<=131072));
DO $reconciliation_fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reconciliation_cases_integration_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.reconciliation_cases ADD CONSTRAINT reconciliation_cases_integration_tenant_fkey
      FOREIGN KEY (tenant_id,integration_id) REFERENCES finnor_os.tenant_integrations(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reconciliation_cases_source_link_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.reconciliation_cases ADD CONSTRAINT reconciliation_cases_source_link_tenant_fkey
      FOREIGN KEY (tenant_id,source_link_id) REFERENCES finnor_os.external_refs(tenant_id,id);
  END IF;
END $reconciliation_fks$;
CREATE INDEX IF NOT EXISTS reconciliation_cases_source_truth_idx
  ON finnor_os.reconciliation_cases(tenant_id,integration_id,status,case_type,created_at);

-- Trusted worker/admin roles can bypass RLS, so every source/account reference also
-- has a composite tenant foreign key. RLS remains mandatory for application reads.
ALTER TABLE finnor_os.integration_sync_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.integration_sync_checkpoints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.integration_sync_checkpoints;
CREATE POLICY tenant_isolation ON finnor_os.integration_sync_checkpoints
  USING (tenant_id=finnor_os.request_tenant_id())
  WITH CHECK (tenant_id=finnor_os.request_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.integration_sync_checkpoints TO finnor_app;
  END IF;
END $grants$;

DROP TRIGGER IF EXISTS tenant_integrations_truth_operational_delta ON finnor_os.tenant_integrations;
CREATE TRIGGER tenant_integrations_truth_operational_delta
  AFTER INSERT OR UPDATE OF health,sync_status,freshness_state,reconciliation_status,unresolved_conflicts
  ON finnor_os.tenant_integrations FOR EACH ROW
  EXECUTE FUNCTION finnor_os.append_operational_delta('integration_truth','integrations,work,activity','','');

DROP TRIGGER IF EXISTS external_refs_truth_operational_delta ON finnor_os.external_refs;
CREATE TRIGGER external_refs_truth_operational_delta
  AFTER INSERT OR UPDATE OF observed_hash,mapping_status,sync_status,conflict_state,provider_deleted
  ON finnor_os.external_refs FOR EACH ROW
  EXECUTE FUNCTION finnor_os.append_operational_delta(
    'source_link',
    'customers,schedule,money,comms,work,activity,queries',
    '',
    ''
  );

COMMENT ON TABLE finnor_os.integration_sync_checkpoints IS
  'Tenant/account/source-scoped provider delta cursor and restart checkpoint; execution remains on the existing jobs worker.';
COMMENT ON TABLE finnor_os.external_refs IS
  'Canonical source-link truth: external identity, observed state/version, ownership, freshness, tombstone, mapping, and drift for one tenant integration.';
COMMENT ON COLUMN finnor_os.integration_operations.verification_status IS
  'Provider acceptance is awaiting_observation; verified requires external read-back/event evidence matching the authorized effect.';
