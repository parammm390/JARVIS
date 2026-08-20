-- Phase 6: governed client release promotion and lifecycle audit.
--
-- ClientRelease remains the Phase 5 immutable artifact. This migration adds only:
--   1. its certified, reference-only configuration snapshot;
--   2. an append-only promotion history plus one mutable active pointer; and
--   3. an operator evidence ledger with one active mutation per client.
-- No resolved secret or external business side effect belongs in these tables.

CREATE TABLE IF NOT EXISTS finnor_os.client_release_configurations (
  release_id text PRIMARY KEY REFERENCES finnor_os.client_releases(release_id),
  client_key text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  manifest_snapshot jsonb NOT NULL CHECK (
    jsonb_typeof(manifest_snapshot)='object'
    AND manifest_snapshot->>'clientKey'=client_key
  ),
  certified_state jsonb NOT NULL CHECK (jsonb_typeof(certified_state)='object'),
  certified_state_hash text NOT NULL CHECK (certified_state_hash ~ '^[0-9a-f]{64}$'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_release_configurations_client_idx
  ON finnor_os.client_release_configurations(client_key,tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS client_release_configurations_tenant_fk_idx
  ON finnor_os.client_release_configurations(tenant_id);

CREATE TABLE IF NOT EXISTS finnor_os.client_lifecycle_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  tenant_id uuid REFERENCES finnor_os.tenants(id),
  operation_type text NOT NULL CHECK (operation_type IN ('status','diff','dry_run','apply','certify','promote','drift','rollback')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','PASS','FAIL','BLOCKED_CONFIG','NOOP')),
  plan_id text,
  desired_manifest_hash text CHECK (desired_manifest_hash IS NULL OR desired_manifest_hash ~ '^[0-9a-f]{64}$'),
  from_release_id text REFERENCES finnor_os.client_releases(release_id),
  to_release_id text REFERENCES finnor_os.client_releases(release_id),
  plan jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(plan)='object'),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  evidence_hash text CHECK (evidence_hash IS NULL OR evidence_hash ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS client_lifecycle_one_active_mutation_idx
  ON finnor_os.client_lifecycle_operations(client_key)
  WHERE status='running' AND operation_type IN ('apply','certify','promote','rollback');
CREATE INDEX IF NOT EXISTS client_lifecycle_operations_history_idx
  ON finnor_os.client_lifecycle_operations(client_key,started_at DESC);
CREATE INDEX IF NOT EXISTS client_lifecycle_operations_tenant_fk_idx
  ON finnor_os.client_lifecycle_operations(tenant_id);
CREATE INDEX IF NOT EXISTS client_lifecycle_operations_from_release_fk_idx
  ON finnor_os.client_lifecycle_operations(from_release_id) WHERE from_release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_lifecycle_operations_to_release_fk_idx
  ON finnor_os.client_lifecycle_operations(to_release_id) WHERE to_release_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.client_release_promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  release_id text NOT NULL REFERENCES finnor_os.client_releases(release_id),
  previous_release_id text REFERENCES finnor_os.client_releases(release_id),
  operation_id uuid NOT NULL UNIQUE REFERENCES finnor_os.client_lifecycle_operations(id),
  kind text NOT NULL CHECK (kind IN ('promotion','rollback')),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  promoted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_release_promotions_history_idx
  ON finnor_os.client_release_promotions(client_key,tenant_id,promoted_at DESC);
CREATE INDEX IF NOT EXISTS client_release_promotions_release_fk_idx
  ON finnor_os.client_release_promotions(release_id);
CREATE INDEX IF NOT EXISTS client_release_promotions_previous_release_fk_idx
  ON finnor_os.client_release_promotions(previous_release_id) WHERE previous_release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS client_release_promotions_tenant_fk_idx
  ON finnor_os.client_release_promotions(tenant_id);

CREATE TABLE IF NOT EXISTS finnor_os.active_client_releases (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  client_key text NOT NULL UNIQUE,
  release_id text NOT NULL REFERENCES finnor_os.client_releases(release_id),
  promotion_id uuid NOT NULL REFERENCES finnor_os.client_release_promotions(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  promoted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS active_client_releases_release_fk_idx
  ON finnor_os.active_client_releases(release_id);
CREATE INDEX IF NOT EXISTS active_client_releases_promotion_fk_idx
  ON finnor_os.active_client_releases(promotion_id);

CREATE OR REPLACE FUNCTION finnor_os.guard_client_lifecycle_operation_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'client lifecycle operation evidence cannot be deleted';
  END IF;
  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'terminal client lifecycle operation evidence is immutable';
  END IF;
  IF NEW.id <> OLD.id OR NEW.client_key <> OLD.client_key OR NEW.operation_type <> OLD.operation_type
     OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'client lifecycle operation identity is immutable';
  END IF;
  IF NEW.status='running' OR NEW.finished_at IS NULL OR NEW.evidence_hash IS NULL THEN
    RAISE EXCEPTION 'client lifecycle operation must transition once to terminal evidence';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.guard_client_lifecycle_operation_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS client_lifecycle_operation_guard ON finnor_os.client_lifecycle_operations;
CREATE TRIGGER client_lifecycle_operation_guard
  BEFORE UPDATE OR DELETE ON finnor_os.client_lifecycle_operations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_client_lifecycle_operation_mutation();

DO $lifecycle$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'client_release_configurations','client_lifecycle_operations',
    'client_release_promotions','active_client_releases'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('REVOKE ALL ON finnor_os.%I FROM PUBLIC',table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
      EXECUTE format('REVOKE ALL ON finnor_os.%I FROM finnor_app',table_name);
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['client_release_configurations','client_release_promotions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS certification_artifact_immutable ON finnor_os.%I',table_name);
    EXECUTE format('CREATE TRIGGER certification_artifact_immutable BEFORE UPDATE OR DELETE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_certification_artifact_mutation()',table_name);
  END LOOP;
END $lifecycle$;
