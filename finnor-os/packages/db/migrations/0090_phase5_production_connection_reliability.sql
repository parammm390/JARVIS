-- Phase 5: production connection, deployment, and reliability fabric.
--
-- This migration extends the Phase 1 auth profile, the canonical jobs queue, the
-- Phase 3 computer run, and the existing provider breaker. It deliberately does
-- not introduce a parallel identity, credential, queue, or execution model.

-- ---------------------------------------------------------------------------
-- Governed connection lifecycle (secrets remain in the managed secret backend).
-- ---------------------------------------------------------------------------
ALTER TABLE finnor_os.tenant_settings
  ADD COLUMN IF NOT EXISTS connection_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS connection_policy jsonb NOT NULL DEFAULT jsonb_build_object(
    'failClosedStatuses',jsonb_build_array('disconnected','connecting','expired','reauth_required','revoked','disabled','misconfigured','provider_unavailable'),
    'healthCheckMinutes',15
  );
ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_connection_shape_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_connection_shape_check CHECK (
  jsonb_typeof(connection_requirements)='array' AND jsonb_typeof(connection_policy)='object'
);
ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_connection_no_secrets_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_connection_no_secrets_check CHECK (
  (connection_requirements::text||connection_policy::text) !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
);

ALTER TABLE finnor_os.auth_profiles
  ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'managed_secret',
  ADD COLUMN IF NOT EXISTS connection_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS connection_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS required_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS granted_scopes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS provider_subject_ref text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS reauth_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_error_code text,
  ADD COLUMN IF NOT EXISTS connection_revision integer NOT NULL DEFAULT 1;

ALTER TABLE finnor_os.auth_profiles DROP CONSTRAINT IF EXISTS auth_profiles_auth_method_check;
ALTER TABLE finnor_os.auth_profiles ADD CONSTRAINT auth_profiles_auth_method_check
  CHECK (auth_method IN ('managed_secret','oauth2','browser_profile'));
ALTER TABLE finnor_os.auth_profiles DROP CONSTRAINT IF EXISTS auth_profiles_connection_status_check;
ALTER TABLE finnor_os.auth_profiles ADD CONSTRAINT auth_profiles_connection_status_check
  CHECK (connection_status IN (
    'disconnected','connecting','active','degraded','expired','reauth_required',
    'revoked','disabled','misconfigured','provider_unavailable'
  ));
ALTER TABLE finnor_os.auth_profiles DROP CONSTRAINT IF EXISTS auth_profiles_scope_shape_check;
ALTER TABLE finnor_os.auth_profiles ADD CONSTRAINT auth_profiles_scope_shape_check CHECK (
  array_position(required_scopes,NULL) IS NULL
  AND array_position(granted_scopes,NULL) IS NULL
  AND cardinality(required_scopes)<=64 AND cardinality(granted_scopes)<=128
);
ALTER TABLE finnor_os.auth_profiles DROP CONSTRAINT IF EXISTS auth_profiles_connection_revision_check;
ALTER TABLE finnor_os.auth_profiles ADD CONSTRAINT auth_profiles_connection_revision_check
  CHECK (connection_revision>=1);

-- Existing credential-backed profiles were already runnable before Phase 5. They
-- retain that behavior; new OAuth/browser rows must opt in explicitly.
UPDATE finnor_os.auth_profiles
SET auth_method='managed_secret',
    connection_status=CASE WHEN status='active' THEN 'active' ELSE 'disabled' END,
    connected_at=coalesce(connected_at,created_at)
WHERE auth_method='managed_secret' AND connected_at IS NULL;

ALTER TABLE finnor_os.communication_identities
  ADD COLUMN IF NOT EXISTS auth_profile_id uuid;
ALTER TABLE finnor_os.communication_identities
  DROP CONSTRAINT IF EXISTS communication_identities_auth_profile_tenant_fkey;
ALTER TABLE finnor_os.communication_identities
  ADD CONSTRAINT communication_identities_auth_profile_tenant_fkey
  FOREIGN KEY (tenant_id,auth_profile_id)
  REFERENCES finnor_os.auth_profiles(tenant_id,id);
CREATE INDEX IF NOT EXISTS communication_identities_auth_profile_idx
  ON finnor_os.communication_identities(tenant_id,auth_profile_id)
  WHERE auth_profile_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.oauth_connection_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  auth_profile_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  provider text NOT NULL,
  state_hash text NOT NULL UNIQUE CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  pkce_challenge text NOT NULL CHECK (length(pkce_challenge) BETWEEN 43 AND 128),
  redirect_uri text NOT NULL CHECK (redirect_uri ~ '^https?://'),
  requested_scopes text[] NOT NULL CHECK (cardinality(requested_scopes) BETWEEN 1 AND 64),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_connection_requests_profile_tenant_fkey
    FOREIGN KEY (tenant_id,auth_profile_id) REFERENCES finnor_os.auth_profiles(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT oauth_connection_requests_actor_tenant_fkey
    FOREIGN KEY (tenant_id,actor_id) REFERENCES finnor_os.users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS oauth_connection_requests_expiry_idx
  ON finnor_os.oauth_connection_requests(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS oauth_connection_requests_tenant_profile_idx
  ON finnor_os.oauth_connection_requests(tenant_id,auth_profile_id,created_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  auth_profile_id uuid NOT NULL,
  actor_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'connect_started','connect_failed','connected','refreshed','verified','degraded',
    'reauth_required','revoked','disabled','reconnected','provider_unavailable'
  )),
  from_status text,
  to_status text NOT NULL,
  reason_code text,
  trace_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT connection_events_profile_tenant_fkey
    FOREIGN KEY (tenant_id,auth_profile_id) REFERENCES finnor_os.auth_profiles(tenant_id,id),
  CONSTRAINT connection_events_actor_tenant_fkey
    FOREIGN KEY (tenant_id,actor_id) REFERENCES finnor_os.users(tenant_id,id)
);
ALTER TABLE finnor_os.connection_events DROP CONSTRAINT IF EXISTS connection_events_metadata_no_secrets;
ALTER TABLE finnor_os.connection_events ADD CONSTRAINT connection_events_metadata_no_secrets CHECK (
  metadata::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
);
CREATE INDEX IF NOT EXISTS connection_events_tenant_profile_idx
  ON finnor_os.connection_events(tenant_id,auth_profile_id,created_at DESC);

-- Consume a callback state exactly once without revealing any connection or secret
-- material. The callback can then re-enter the ordinary tenant-scoped runtime.
CREATE OR REPLACE FUNCTION finnor_os.consume_oauth_connection_request(p_state_hash text)
RETURNS TABLE(request_id uuid,tenant_id uuid,auth_profile_id uuid,actor_id uuid,provider text,pkce_challenge text,redirect_uri text,requested_scopes text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  RETURN QUERY
    UPDATE finnor_os.oauth_connection_requests r
       SET consumed_at=now()
     WHERE r.state_hash=p_state_hash
       AND r.consumed_at IS NULL
       AND r.expires_at>now()
    RETURNING r.id,r.tenant_id,r.auth_profile_id,r.actor_id,r.provider,r.pkce_challenge,r.redirect_uri,r.requested_scopes;
END $$;
REVOKE ALL ON FUNCTION finnor_os.consume_oauth_connection_request(text) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Multi-worker renewable leases and exact fleet/release identity.
-- ---------------------------------------------------------------------------
ALTER TABLE finnor_os.jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_heartbeat_at timestamptz;
CREATE INDEX IF NOT EXISTS jobs_expired_lease_idx
  ON finnor_os.jobs(lease_expires_at) WHERE status='running';

ALTER TABLE finnor_os.provider_circuit_state
  ADD COLUMN IF NOT EXISTS probe_lease_owner text,
  ADD COLUMN IF NOT EXISTS probe_lease_expires_at timestamptz;

CREATE TABLE IF NOT EXISTS finnor_os.service_release_heartbeats (
  service text NOT NULL,
  instance_id text NOT NULL,
  release_sha text NOT NULL,
  build_id text NOT NULL,
  version text NOT NULL,
  release_source text NOT NULL,
  core_certification_id text,
  migration_head text NOT NULL,
  deployment_id text,
  capabilities text[] NOT NULL DEFAULT '{}',
  environment text NOT NULL,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service,instance_id)
);
ALTER TABLE finnor_os.service_release_heartbeats
  ADD COLUMN IF NOT EXISTS build_id text,
  ADD COLUMN IF NOT EXISTS version text,
  ADD COLUMN IF NOT EXISTS release_source text,
  ADD COLUMN IF NOT EXISTS core_certification_id text;
UPDATE finnor_os.service_release_heartbeats
SET build_id=coalesce(build_id,'unknown'),
    version=coalesce(version,'unknown'),
    release_source=coalesce(release_source,'unknown');
ALTER TABLE finnor_os.service_release_heartbeats
  ALTER COLUMN build_id SET NOT NULL,
  ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN release_source SET NOT NULL;
CREATE INDEX IF NOT EXISTS service_release_heartbeats_fresh_idx
  ON finnor_os.service_release_heartbeats(service,last_beat_at DESC);

-- ---------------------------------------------------------------------------
-- Computer hard deadlines/orphan reconciliation and configurable data classes.
-- ---------------------------------------------------------------------------
ALTER TABLE finnor_os.computer_runs
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleanup_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS cleanup_failure_code text;
CREATE INDEX IF NOT EXISTS computer_runs_stale_active_idx
  ON finnor_os.computer_runs(deadline_at,last_heartbeat_at)
  WHERE status IN ('authorizing','provisioning','authenticating','running','reconciling');

CREATE TABLE IF NOT EXISTS finnor_os.tenant_retention_policies (
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  data_class text NOT NULL CHECK (data_class IN (
    'messages','job_payloads','computer_artifact_content','model_records'
  )),
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  legal_hold boolean NOT NULL DEFAULT false,
  managed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,data_class),
  CONSTRAINT tenant_retention_policies_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.tenant_rate_limit_policies (
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  provider text NOT NULL CHECK (provider=lower(provider) AND provider ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  action text NOT NULL CHECK (btrim(action)<>'' AND length(action)<=120),
  per_minute integer NOT NULL CHECK (per_minute BETWEEN 1 AND 1000000),
  managed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,provider,action),
  CONSTRAINT tenant_rate_limit_policies_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

-- Phase 3 artifacts remain append-only as evidence records, but their potentially
-- sensitive bytes may be redacted after the configured period. Hash, size, MIME,
-- provenance, and metadata cannot be rewritten.
CREATE OR REPLACE FUNCTION finnor_os.guard_computer_artifact_retention() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'computer artifacts are append-only'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.step_id IS DISTINCT FROM OLD.step_id OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.content IS NULL AND NEW.content IS NOT NULL)
     OR (OLD.storage_ref IS NULL AND NEW.storage_ref IS NOT NULL) THEN
    RAISE EXCEPTION 'computer artifact evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_computer_artifact_retention() FROM PUBLIC;
DROP TRIGGER IF EXISTS computer_artifacts_append_only ON finnor_os.computer_artifacts;
CREATE TRIGGER computer_artifacts_append_only BEFORE UPDATE OR DELETE ON finnor_os.computer_artifacts
FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_computer_artifact_retention();

-- Connection rows and retention policy are canonical tenant data. OAuth request
-- reads are tenant-scoped; only the narrow consume function crosses that boundary.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['oauth_connection_requests','connection_events','tenant_retention_policies','tenant_rate_limit_policies'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.oauth_connection_requests,finnor_os.tenant_retention_policies,finnor_os.tenant_rate_limit_policies TO finnor_app;
    GRANT SELECT,INSERT ON finnor_os.connection_events TO finnor_app;
    REVOKE UPDATE,DELETE ON finnor_os.connection_events FROM finnor_app;
    GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.service_release_heartbeats TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.consume_oauth_connection_request(text) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_computer_artifact_retention() TO finnor_app;
    GRANT UPDATE(content,storage_ref) ON finnor_os.computer_artifacts TO finnor_app;
  END IF;
END $rls$;

CREATE OR REPLACE FUNCTION finnor_os.forbid_connection_event_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$ BEGIN
  RAISE EXCEPTION 'connection events are append-only';
END $$;
REVOKE ALL ON FUNCTION finnor_os.forbid_connection_event_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS connection_events_immutable ON finnor_os.connection_events;
CREATE TRIGGER connection_events_immutable BEFORE UPDATE OR DELETE ON finnor_os.connection_events
FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_connection_event_mutation();
