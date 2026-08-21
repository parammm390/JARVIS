-- Phase 4: durable, resumable client factory orchestration.
--
-- This is deliberately a small onboarding ledger driven by the existing jobs table,
-- not another general workflow runtime. Runs retain the validated manifest snapshot
-- (references and configuration only, never resolved secrets); stages retain current
-- state while the append-only attempt table preserves every prior result/failure.

CREATE TABLE IF NOT EXISTS finnor_os.client_factory_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  tenant_id uuid REFERENCES finnor_os.tenants(id),
  manifest_version integer NOT NULL CHECK (manifest_version > 0),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_snapshot jsonb NOT NULL CHECK (jsonb_typeof(manifest_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','passed','failed','blocked_config','cancelled')),
  current_stage text,
  lease_owner text,
  lease_expires_at timestamptz,
  dispatch_version integer NOT NULL DEFAULT 0 CHECK (dispatch_version >= 0),
  cancel_requested_at timestamptz,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_factory_runs_client_key_format_check
    CHECK (client_key = lower(client_key) AND client_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$')
);

-- A failed or configuration-blocked run remains the one resumable mutation path.
-- A new run is permitted only after the prior path passes or is explicitly cancelled.
CREATE UNIQUE INDEX IF NOT EXISTS client_factory_one_active_client_idx
  ON finnor_os.client_factory_runs(client_key)
  WHERE status IN ('pending','running','failed','blocked_config');
CREATE INDEX IF NOT EXISTS client_factory_runs_tenant_idx
  ON finnor_os.client_factory_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS client_factory_runs_lease_idx
  ON finnor_os.client_factory_runs(lease_expires_at)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS finnor_os.client_factory_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES finnor_os.client_factory_runs(id),
  stage_key text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','passed','failed','blocked_config','cancelled')),
  input_sha256 text CHECK (input_sha256 IS NULL OR input_sha256 ~ '^[0-9a-f]{64}$'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, stage_key),
  UNIQUE (run_id, ordinal)
);
CREATE INDEX IF NOT EXISTS client_factory_stages_run_idx
  ON finnor_os.client_factory_stages(run_id, ordinal);

CREATE TABLE IF NOT EXISTS finnor_os.client_factory_stage_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES finnor_os.client_factory_runs(id),
  stage_id uuid NOT NULL REFERENCES finnor_os.client_factory_stages(id),
  stage_key text NOT NULL,
  attempt integer NOT NULL CHECK (attempt > 0),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('running','passed','failed','blocked_config','cancelled')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (stage_id, attempt)
);
CREATE INDEX IF NOT EXISTS client_factory_attempts_run_stage_idx
  ON finnor_os.client_factory_stage_attempts(run_id, stage_key, attempt DESC);

-- Factory state is an administrative cross-tenant control plane. The restricted
-- application role must not be able to read manifests or mutate onboarding runs.
REVOKE ALL ON finnor_os.client_factory_runs FROM PUBLIC;
REVOKE ALL ON finnor_os.client_factory_stages FROM PUBLIC;
REVOKE ALL ON finnor_os.client_factory_stage_attempts FROM PUBLIC;
DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    REVOKE ALL ON finnor_os.client_factory_runs FROM finnor_app;
    REVOKE ALL ON finnor_os.client_factory_stages FROM finnor_app;
    REVOKE ALL ON finnor_os.client_factory_stage_attempts FROM finnor_app;
  END IF;
END $grants$;
