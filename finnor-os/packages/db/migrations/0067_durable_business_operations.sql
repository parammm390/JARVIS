-- Upgrade 6: durable business operations.
--
-- Domain actions remain the approval/authority boundary. These additive tables hold
-- the frozen cohort and recoverable per-target execution after approval. The first
-- operation type is customer_winback; this is intentionally not a generic workflow
-- language.

CREATE TABLE IF NOT EXISTS finnor_os.business_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid REFERENCES finnor_os.works(id),
  domain_action_id uuid NOT NULL REFERENCES finnor_os.domain_actions(id),
  operation_type text NOT NULL CHECK (operation_type IN ('customer_winback')),
  status text NOT NULL DEFAULT 'awaiting_approval' CHECK (status IN (
    'awaiting_approval','queued','running','completed','completed_with_failures',
    'needs_human_review','failed','cancelled'
  )),
  configuration jsonb NOT NULL DEFAULT '{}',
  cohort_definition jsonb NOT NULL DEFAULT '{}',
  cohort_frozen_at timestamptz NOT NULL DEFAULT now(),
  target_count integer NOT NULL DEFAULT 0 CHECK (target_count >= 0),
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count >= 0),
  running_count integer NOT NULL DEFAULT 0 CHECK (running_count >= 0),
  succeeded_count integer NOT NULL DEFAULT 0 CHECK (succeeded_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  next_batch_sequence integer NOT NULL DEFAULT 0 CHECK (next_batch_sequence >= 0),
  approved_by text,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  final_outcome jsonb,
  failure jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain_action_id)
);
CREATE INDEX IF NOT EXISTS business_operations_tenant_work_idx ON finnor_os.business_operations(tenant_id, work_id);
CREATE INDEX IF NOT EXISTS business_operations_tenant_status_idx ON finnor_os.business_operations(tenant_id, status);

CREATE TABLE IF NOT EXISTS finnor_os.business_operation_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  operation_id uuid NOT NULL REFERENCES finnor_os.business_operations(id),
  target_type text NOT NULL DEFAULT 'household' CHECK (target_type IN ('household')),
  target_id uuid NOT NULL REFERENCES finnor_os.households(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','skipped','retry')),
  frozen_snapshot jsonb NOT NULL DEFAULT '{}',
  prepared_payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text NOT NULL UNIQUE,
  job_key text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  failure_class text CHECK (failure_class IS NULL OR failure_class IN ('retryable','policy','configuration','invalid_input','human_review')),
  error_kind text CHECK (error_kind IS NULL OR error_kind IN ('retryable','terminal','conflict','auth','validation','provider_down','needs_human','config')),
  last_error text,
  provider_ref text,
  evidence jsonb NOT NULL DEFAULT '[]',
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, target_id)
);
CREATE INDEX IF NOT EXISTS business_operation_targets_operation_status_idx
  ON finnor_os.business_operation_targets(operation_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS business_operation_targets_tenant_target_idx
  ON finnor_os.business_operation_targets(tenant_id, target_id);

CREATE TABLE IF NOT EXISTS finnor_os.business_operation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  operation_id uuid NOT NULL REFERENCES finnor_os.business_operations(id),
  target_id uuid REFERENCES finnor_os.business_operation_targets(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (operation_id, sequence)
);
CREATE INDEX IF NOT EXISTS business_operation_events_tenant_operation_idx
  ON finnor_os.business_operation_events(tenant_id, operation_id, sequence);

ALTER TABLE finnor_os.decision_receipts
  ADD COLUMN IF NOT EXISTS operation_id uuid REFERENCES finnor_os.business_operations(id);
CREATE UNIQUE INDEX IF NOT EXISTS decision_receipts_operation_idx
  ON finnor_os.decision_receipts(operation_id) WHERE operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finnor_os.assert_business_operation_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  action_tenant uuid;
  action_work uuid;
BEGIN
  SELECT tenant_id, work_id INTO action_tenant, action_work
  FROM finnor_os.domain_actions WHERE id = NEW.domain_action_id;
  IF action_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'business operation action does not belong to tenant';
  END IF;
  IF NEW.work_id IS NOT NULL AND action_work IS DISTINCT FROM NEW.work_id THEN
    RAISE EXCEPTION 'business operation Work does not match its action';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_operations_scope ON finnor_os.business_operations;
CREATE TRIGGER business_operations_scope
  BEFORE INSERT OR UPDATE ON finnor_os.business_operations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_business_operation_scope();

CREATE OR REPLACE FUNCTION finnor_os.assert_business_operation_child_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE operation_tenant uuid;
BEGIN
  SELECT tenant_id INTO operation_tenant
  FROM finnor_os.business_operations WHERE id = NEW.operation_id;
  IF operation_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'business operation child does not belong to tenant';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS business_operation_targets_scope ON finnor_os.business_operation_targets;
CREATE TRIGGER business_operation_targets_scope
  BEFORE INSERT OR UPDATE ON finnor_os.business_operation_targets
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_business_operation_child_scope();
DROP TRIGGER IF EXISTS business_operation_events_scope ON finnor_os.business_operation_events;
CREATE TRIGGER business_operation_events_scope
  BEFORE INSERT ON finnor_os.business_operation_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_business_operation_child_scope();

-- The event stream is evidence, not mutable state.
DROP TRIGGER IF EXISTS business_operation_events_immutable ON finnor_os.business_operation_events;
CREATE TRIGGER business_operation_events_immutable
  BEFORE UPDATE OR DELETE ON finnor_os.business_operation_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['business_operations','business_operation_targets','business_operation_events'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.business_operations TO finnor_app;
    GRANT SELECT, INSERT, UPDATE ON finnor_os.business_operation_targets TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.business_operation_events TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_business_operation_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_business_operation_child_scope() TO finnor_app;
    REVOKE DELETE ON finnor_os.business_operations, finnor_os.business_operation_targets, finnor_os.business_operation_events FROM finnor_app;
  END IF;
END $rls$;

-- Work/Upgrade-4 observers refetch on every operation or target transition. The
-- shared trigger emits identifiers only; no cohort or customer data enters NOTIFY.
DROP TRIGGER IF EXISTS business_operations_notify ON finnor_os.business_operations;
CREATE TRIGGER business_operations_notify
  AFTER INSERT OR UPDATE OF status, pending_count, running_count, succeeded_count, failed_count, skipped_count, retry_count
  ON finnor_os.business_operations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('business_operation');
DROP TRIGGER IF EXISTS business_operation_targets_notify ON finnor_os.business_operation_targets;
CREATE TRIGGER business_operation_targets_notify
  AFTER INSERT OR UPDATE OF status ON finnor_os.business_operation_targets
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('business_operation_target');
