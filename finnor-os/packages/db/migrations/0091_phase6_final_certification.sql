-- Phase 6: immutable final production certification artifacts.
-- This extends the existing certification/release machinery. It is a separate
-- append-only index because final certification binds more source and topology
-- identities than a client release, while retaining the same artifact JSON.

CREATE TABLE IF NOT EXISTS finnor_os.final_certifications (
  certification_id text PRIMARY KEY CHECK (certification_id ~ '^finalcert-[0-9a-f]{64}$'),
  canonical_git_sha text NOT NULL CHECK (canonical_git_sha ~ '^[0-9a-f]{40}$'),
  source_tree_hash text NOT NULL CHECK (source_tree_hash ~ '^[0-9a-f]{64}$'),
  suite_version text NOT NULL CHECK (suite_version='phase6-final-v1'),
  suite_hash text NOT NULL CHECK (suite_hash ~ '^[0-9a-f]{64}$'),
  migration_head text NOT NULL,
  migration_source_hash text NOT NULL CHECK (migration_source_hash ~ '^[0-9a-f]{64}$'),
  migration_schema_hash text NOT NULL CHECK (migration_schema_hash ~ '^[0-9a-f]{64}$'),
  action_count integer NOT NULL CHECK (action_count>0),
  action_manifest_hash text NOT NULL CHECK (action_manifest_hash ~ '^[0-9a-f]{64}$'),
  deployment_contract_hash text NOT NULL CHECK (deployment_contract_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('PASS','FAIL','BLOCKED_CONFIG')),
  evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  artifact jsonb NOT NULL CHECK (
    jsonb_typeof(artifact)='object'
    AND artifact->>'schema'='finnor.final-certification/v1'
    AND artifact->>'certificationId'=certification_id
    AND artifact->>'canonicalGitSha'=canonical_git_sha
    AND artifact->>'sourceTreeHash'=source_tree_hash
    AND artifact->>'suiteVersion'=suite_version
    AND artifact->>'suiteHash'=suite_hash
    AND artifact#>>'{migration,head}'=migration_head
    AND artifact#>>'{migration,sourceHash}'=migration_source_hash
    AND artifact#>>'{migration,schemaHash}'=migration_schema_hash
    AND (artifact#>>'{actionManifest,count}')::integer=action_count
    AND artifact#>>'{actionManifest,generatedHash}'=action_manifest_hash
    AND artifact#>>'{deployment,contractHash}'=deployment_contract_hash
    AND artifact->>'status'=status
    AND artifact->>'evidenceHash'=evidence_hash
  ),
  certified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS final_certifications_reuse_idx
  ON finnor_os.final_certifications(canonical_git_sha,source_tree_hash,suite_hash)
  WHERE status='PASS';

DROP TRIGGER IF EXISTS final_certification_artifact_immutable ON finnor_os.final_certifications;
CREATE TRIGGER final_certification_artifact_immutable
  BEFORE UPDATE OR DELETE ON finnor_os.final_certifications
  FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_certification_artifact_mutation();
REVOKE ALL ON finnor_os.final_certifications FROM PUBLIC;
DO $revoke_final$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    REVOKE ALL ON finnor_os.final_certifications FROM finnor_app;
  END IF;
END $revoke_final$;
