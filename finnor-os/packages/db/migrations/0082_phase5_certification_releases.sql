-- Phase 5: append-only core/client certification and immutable client releases.
-- Artifact JSON is already sanitized by release:certify. These tables store the
-- complete content-addressed artifact and the indexed identity/invalidation fields;
-- no credential values or resolved provider secrets belong here.

CREATE TABLE IF NOT EXISTS finnor_os.core_certifications (
  certification_id text PRIMARY KEY CHECK (certification_id ~ '^corecert-[0-9a-f]{64}$'),
  canonical_core_sha text NOT NULL CHECK (canonical_core_sha ~ '^[0-9a-f]{40}$'),
  core_source_tree_hash text NOT NULL CHECK (core_source_tree_hash ~ '^[0-9a-f]{64}$'),
  suite_hash text NOT NULL CHECK (suite_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PASS','FAIL','BLOCKED_CONFIG')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  artifact jsonb NOT NULL CHECK (
    jsonb_typeof(artifact)='object'
    AND artifact->>'schema'='finnor.core-certification/v1'
    AND artifact->>'certificationId'=certification_id
    AND artifact->>'canonicalCoreSha'=canonical_core_sha
    AND artifact->>'coreSourceTreeHash'=core_source_tree_hash
    AND artifact->>'suiteHash'=suite_hash
    AND artifact->>'status'=status
    AND artifact->>'evidenceHash'=evidence_hash
  ),
  certified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS core_certifications_reuse_idx
  ON finnor_os.core_certifications(canonical_core_sha,core_source_tree_hash,suite_hash)
  WHERE status='PASS';

CREATE TABLE IF NOT EXISTS finnor_os.client_certifications (
  certification_id text PRIMARY KEY CHECK (certification_id ~ '^clientcert-[0-9a-f]{64}$'),
  client_key text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  canonical_core_sha text NOT NULL CHECK (canonical_core_sha ~ '^[0-9a-f]{40}$'),
  core_certification_id text NOT NULL REFERENCES finnor_os.core_certifications(certification_id),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  deployment_evidence_hash text NOT NULL CHECK (deployment_evidence_hash ~ '^[0-9a-f]{64}$'),
  migration_version text NOT NULL,
  schema_hash text NOT NULL CHECK (schema_hash ~ '^[0-9a-f]{64}$'),
  suite_hash text NOT NULL CHECK (suite_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PASS','FAIL','BLOCKED_CONFIG')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  artifact jsonb NOT NULL CHECK (
    jsonb_typeof(artifact)='object'
    AND artifact->>'schema'='finnor.client-certification/v1'
    AND artifact->>'certificationId'=certification_id
    AND artifact->>'clientKey'=client_key
    AND artifact->>'tenantId'=tenant_id::text
    AND artifact->>'canonicalCoreSha'=canonical_core_sha
    AND artifact->>'coreCertificationId'=core_certification_id
    AND artifact#>>'{configurationHashes,aggregateHash}'=configuration_hash
    AND artifact->>'deploymentEvidenceHash'=deployment_evidence_hash
    AND artifact->>'migrationVersion'=migration_version
    AND artifact->>'schemaHash'=schema_hash
    AND artifact->>'suiteHash'=suite_hash
    AND artifact->>'status'=status
    AND artifact->>'evidenceHash'=evidence_hash
  ),
  certified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_certifications_current_idx
  ON finnor_os.client_certifications(client_key,tenant_id,canonical_core_sha,configuration_hash,created_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.client_releases (
  release_id text PRIMARY KEY CHECK (release_id ~ '^clientrelease-[0-9a-f]{64}$'),
  release_version text NOT NULL UNIQUE,
  client_key text NOT NULL,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  canonical_core_sha text NOT NULL CHECK (canonical_core_sha ~ '^[0-9a-f]{40}$'),
  core_certification_id text NOT NULL REFERENCES finnor_os.core_certifications(certification_id),
  client_certification_id text NOT NULL REFERENCES finnor_os.client_certifications(certification_id),
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  configuration_hash text NOT NULL CHECK (configuration_hash ~ '^[0-9a-f]{64}$'),
  deployment_evidence_hash text NOT NULL CHECK (deployment_evidence_hash ~ '^[0-9a-f]{64}$'),
  migration_version text NOT NULL,
  schema_hash text NOT NULL CHECK (schema_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PASS','FAIL','BLOCKED_CONFIG')),
  predecessor_release_id text REFERENCES finnor_os.client_releases(release_id),
  rollback_target_release_id text REFERENCES finnor_os.client_releases(release_id),
  artifact jsonb NOT NULL CHECK (
    jsonb_typeof(artifact)='object'
    AND artifact->>'schema'='finnor.client-release/v1'
    AND artifact->>'releaseId'=release_id
    AND artifact->>'version'=release_version
    AND artifact#>>'{client,clientKey}'=client_key
    AND artifact#>>'{client,tenantId}'=tenant_id::text
    AND artifact#>>'{core,canonicalSha}'=canonical_core_sha
    AND artifact#>>'{core,certificationId}'=core_certification_id
    AND artifact#>>'{certification,certificationId}'=client_certification_id
    AND artifact#>>'{configurationHashes,manifestHash}'=manifest_hash
    AND artifact#>>'{configurationHashes,aggregateHash}'=configuration_hash
    AND artifact#>>'{deployment,evidenceHash}'=deployment_evidence_hash
    AND artifact#>>'{database,migrationVersion}'=migration_version
    AND artifact#>>'{database,schemaHash}'=schema_hash
    AND artifact#>>'{certification,status}'=status
  ),
  certified_at timestamptz NOT NULL,
  released_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_certification_id,deployment_evidence_hash)
);
CREATE INDEX IF NOT EXISTS client_releases_client_history_idx
  ON finnor_os.client_releases(client_key,tenant_id,released_at DESC);

CREATE OR REPLACE FUNCTION finnor_os.forbid_certification_artifact_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'certification and client release artifacts are immutable';
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.forbid_certification_artifact_mutation() FROM PUBLIC;

DO $immutable$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['core_certifications','client_certifications','client_releases'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS certification_artifact_immutable ON finnor_os.%I',table_name);
    EXECUTE format('CREATE TRIGGER certification_artifact_immutable BEFORE UPDATE OR DELETE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_certification_artifact_mutation()',table_name);
    EXECUTE format('REVOKE ALL ON finnor_os.%I FROM PUBLIC',table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
      EXECUTE format('REVOKE ALL ON finnor_os.%I FROM finnor_app',table_name);
    END IF;
  END LOOP;
END $immutable$;
