-- Phase 3: governed computer execution + live activity. The Objective Loop remains
-- the only business-level controller; these rows are durable execution state only.

ALTER TABLE finnor_os.tenant_settings
  ADD COLUMN IF NOT EXISTS computer_config jsonb NOT NULL DEFAULT jsonb_build_object(
    'enabled',false,'provider','steel','maxSteps',30,'timeoutMs',300000,
    'maxProviderCredits',10,'maxScreenshots',10,'maxArtifacts',20,
    'maxDownloadBytes',10485760,'maxUploadBytes',0,'maxOutputBytes',131072
  );
ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_computer_config_object_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_computer_config_object_check
  CHECK (jsonb_typeof(computer_config)='object');
ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_computer_config_no_secrets_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_computer_config_no_secrets_check CHECK (
  computer_config::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
);

CREATE TABLE IF NOT EXISTS finnor_os.computer_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  work_id uuid,
  objective_loop_id uuid,
  actor_id uuid NOT NULL,
  application_account_id uuid NOT NULL,
  auth_profile_id uuid NOT NULL,
  auth_profile_ref text NOT NULL,
  application text NOT NULL,
  provider text NOT NULL,
  -- Credential-sensitive runtime handle. It is persisted only so a recovered worker
  -- can release an orphaned session; safe projections must never select this column.
  provider_session_ref text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued','authorizing','provisioning','authenticating','running','reconciling',
    'succeeded','blocked','failed','timed_out','cancelled'
  )),
  mode text NOT NULL CHECK (mode IN ('READ_ONLY','WRITE')),
  task text NOT NULL CHECK (char_length(task) BETWEEN 3 AND 4000),
  target jsonb NOT NULL CHECK (jsonb_typeof(target)='object'),
  authorized_effect jsonb,
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_origins)='array'),
  auth_origins jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(auth_origins)='array'),
  limits jsonb NOT NULL CHECK (jsonb_typeof(limits)='object'),
  result jsonb,
  failure_code text,
  block_reason text,
  effect_status text NOT NULL DEFAULT 'none' CHECK (effect_status IN ('none','pending','dispatching','succeeded','failed','unknown')),
  effect_operation_key text,
  cancellation_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  session_released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computer_runs_domain_action_unique UNIQUE (domain_action_id),
  CONSTRAINT computer_runs_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT computer_runs_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT computer_runs_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
    REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT computer_runs_objective_tenant_fkey FOREIGN KEY (tenant_id,objective_loop_id)
    REFERENCES finnor_os.work_objective_loops(tenant_id,id),
  CONSTRAINT computer_runs_actor_tenant_fkey FOREIGN KEY (tenant_id,actor_id)
    REFERENCES finnor_os.users(tenant_id,id),
  CONSTRAINT computer_runs_account_tenant_fkey FOREIGN KEY (tenant_id,application_account_id)
    REFERENCES finnor_os.application_accounts(tenant_id,id),
  CONSTRAINT computer_runs_auth_profile_tenant_fkey FOREIGN KEY (tenant_id,auth_profile_id)
    REFERENCES finnor_os.auth_profiles(tenant_id,id),
  CONSTRAINT computer_runs_mode_effect_check CHECK (
    (mode='READ_ONLY' AND authorized_effect IS NULL AND effect_status='none') OR
    (mode='WRITE' AND authorized_effect IS NOT NULL AND jsonb_typeof(authorized_effect)='object')
  ),
  CONSTRAINT computer_runs_terminal_time_check CHECK (
    (status IN ('succeeded','blocked','failed','timed_out','cancelled') AND finished_at IS NOT NULL)
    OR (status NOT IN ('succeeded','blocked','failed','timed_out','cancelled'))
  )
);

CREATE INDEX IF NOT EXISTS computer_runs_tenant_status_created_idx
  ON finnor_os.computer_runs(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS computer_runs_tenant_work_idx
  ON finnor_os.computer_runs(tenant_id,work_id,created_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.computer_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  run_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq > 0),
  phase text NOT NULL CHECK (phase IN (
    'queued','authorizing','provisioning','authenticating','running','reconciling',
    'succeeded','blocked','failed','timed_out','cancelled'
  )),
  operation text NOT NULL CHECK (char_length(operation) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started','succeeded','blocked','failed')),
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1000),
  page_url text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object'),
  effect_candidate_hash text,
  authority_decision_id uuid REFERENCES finnor_os.authority_decisions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT computer_steps_run_seq_unique UNIQUE (run_id,seq),
  CONSTRAINT computer_steps_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT computer_steps_run_tenant_fkey FOREIGN KEY (tenant_id,run_id)
    REFERENCES finnor_os.computer_runs(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT computer_steps_completion_check CHECK (
    (status='started' AND completed_at IS NULL) OR (status<>'started' AND completed_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS computer_steps_tenant_run_created_idx
  ON finnor_os.computer_steps(tenant_id,run_id,created_at);

CREATE TABLE IF NOT EXISTS finnor_os.computer_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  run_id uuid NOT NULL,
  step_id uuid,
  kind text NOT NULL CHECK (kind IN ('dom_snapshot','screenshot','download','upload','result_evidence')),
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_ref text,
  content bytea,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computer_artifacts_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT computer_artifacts_run_tenant_fkey FOREIGN KEY (tenant_id,run_id)
    REFERENCES finnor_os.computer_runs(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT computer_artifacts_step_tenant_fkey FOREIGN KEY (tenant_id,step_id)
    REFERENCES finnor_os.computer_steps(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT computer_artifacts_content_size_check CHECK (
    content IS NULL OR octet_length(content)=size_bytes
  )
);
CREATE INDEX IF NOT EXISTS computer_artifacts_tenant_run_created_idx
  ON finnor_os.computer_artifacts(tenant_id,run_id,created_at);

-- Safe persisted JSON may contain business results, but never credential-shaped
-- fields. Sensitive browser/profile/session identifiers have dedicated restricted
-- columns and are excluded from all normal read paths.
CREATE OR REPLACE FUNCTION finnor_os.computer_json_contains_secret(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(value::text ~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:',false)
$$;
REVOKE ALL ON FUNCTION finnor_os.computer_json_contains_secret(jsonb) FROM PUBLIC;

ALTER TABLE finnor_os.computer_runs ADD CONSTRAINT computer_runs_safe_json_check CHECK (
  NOT finnor_os.computer_json_contains_secret(target)
  AND NOT finnor_os.computer_json_contains_secret(coalesce(authorized_effect,'{}'::jsonb))
  AND NOT finnor_os.computer_json_contains_secret(limits)
  AND NOT finnor_os.computer_json_contains_secret(coalesce(result,'{}'::jsonb))
);
ALTER TABLE finnor_os.computer_steps ADD CONSTRAINT computer_steps_safe_detail_check
  CHECK (NOT finnor_os.computer_json_contains_secret(detail));
ALTER TABLE finnor_os.computer_artifacts ADD CONSTRAINT computer_artifacts_safe_metadata_check
  CHECK (NOT finnor_os.computer_json_contains_secret(metadata));

CREATE OR REPLACE FUNCTION finnor_os.guard_computer_run_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF OLD.status IN ('succeeded','blocked','failed','timed_out','cancelled') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'terminal computer run status is immutable';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.application_account_id IS DISTINCT FROM OLD.application_account_id
     OR NEW.auth_profile_id IS DISTINCT FROM OLD.auth_profile_id
     OR NEW.auth_profile_ref IS DISTINCT FROM OLD.auth_profile_ref
     OR NEW.application IS DISTINCT FROM OLD.application
     OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.task IS DISTINCT FROM OLD.task
     OR NEW.target IS DISTINCT FROM OLD.target
     OR NEW.authorized_effect IS DISTINCT FROM OLD.authorized_effect
     OR NEW.allowed_origins IS DISTINCT FROM OLD.allowed_origins
     OR NEW.auth_origins IS DISTINCT FROM OLD.auth_origins
     OR NEW.limits IS DISTINCT FROM OLD.limits THEN
    RAISE EXCEPTION 'computer run authorization envelope is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_computer_run_transition() FROM PUBLIC;
DROP TRIGGER IF EXISTS computer_runs_transition_guard ON finnor_os.computer_runs;
CREATE TRIGGER computer_runs_transition_guard BEFORE UPDATE ON finnor_os.computer_runs
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_computer_run_transition();

CREATE OR REPLACE FUNCTION finnor_os.guard_computer_step_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF OLD.status<>'started' THEN RAISE EXCEPTION 'terminal computer step is immutable'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.seq IS DISTINCT FROM OLD.seq OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.operation IS DISTINCT FROM OLD.operation OR NEW.summary IS DISTINCT FROM OLD.summary THEN
    RAISE EXCEPTION 'computer step identity is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_computer_step_update() FROM PUBLIC;
DROP TRIGGER IF EXISTS computer_steps_update_guard ON finnor_os.computer_steps;
CREATE TRIGGER computer_steps_update_guard BEFORE UPDATE ON finnor_os.computer_steps
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_computer_step_update();

DROP TRIGGER IF EXISTS computer_artifacts_append_only ON finnor_os.computer_artifacts;
CREATE TRIGGER computer_artifacts_append_only BEFORE UPDATE OR DELETE ON finnor_os.computer_artifacts
  FOR EACH ROW EXECUTE FUNCTION finnor_os.prevent_append_only_mutation();

-- Durable state is written first; the existing IDs-only JARVIS NOTIFY transport then
-- invalidates safe tenant reads. NOTIFY never contains the step detail or session ref.
DROP TRIGGER IF EXISTS computer_runs_notify ON finnor_os.computer_runs;
CREATE TRIGGER computer_runs_notify AFTER INSERT OR UPDATE OF status ON finnor_os.computer_runs
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('computer_run');
DROP TRIGGER IF EXISTS computer_steps_notify ON finnor_os.computer_steps;
CREATE TRIGGER computer_steps_notify AFTER INSERT OR UPDATE OF status ON finnor_os.computer_steps
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('computer_step');

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['computer_runs','computer_steps','computer_artifacts'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.computer_runs,finnor_os.computer_steps TO finnor_app;
    GRANT SELECT,INSERT ON finnor_os.computer_artifacts TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.computer_json_contains_secret(jsonb) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_computer_run_transition() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_computer_step_update() TO finnor_app;
  END IF;
END $rls$;
