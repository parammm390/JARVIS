-- Phase 2: tenant integration credentials are references, never values.
--
-- credential_provider identifies the secret backend. credential_ref is an opaque
-- provider reference (for AWS, a secret id/ARN); credential_version is an optional
-- rotation stage/version. credential_metadata may contain public account routing
-- data such as account ids or sandbox/production mode, but never authentication
-- material. Runtime resolution additionally requires AWS tenant refs to contain the
-- authenticated tenant id, preventing a valid-looking reference to another dealer.

ALTER TABLE finnor_os.tenant_integrations
  ADD COLUMN IF NOT EXISTS credential_provider text,
  ADD COLUMN IF NOT EXISTS credential_ref text,
  ADD COLUMN IF NOT EXISTS credential_version text,
  ADD COLUMN IF NOT EXISTS credential_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_credential_contract_check;
ALTER TABLE finnor_os.tenant_integrations
  ADD CONSTRAINT tenant_integrations_credential_contract_check CHECK (
    (
      credential_provider IS NULL
      AND credential_ref IS NULL
      AND credential_version IS NULL
      AND credential_metadata = '{}'::jsonb
    )
    OR (
      credential_provider = 'aws-secrets-manager'
      AND credential_ref IS NOT NULL
      AND btrim(credential_ref) <> ''
      AND (credential_version IS NULL OR btrim(credential_version) <> '')
    )
    OR (
      credential_provider = 'legacy-env'
      AND credential_ref ~ '^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|resend|meta_ads|google_ads)$'
      AND credential_version IS NULL
    )
  );

ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_credential_metadata_object_check;
ALTER TABLE finnor_os.tenant_integrations
  ADD CONSTRAINT tenant_integrations_credential_metadata_object_check CHECK (
    jsonb_typeof(credential_metadata) = 'object'
  );

-- Reject credential-shaped keys recursively by inspecting JSON object syntax. This
-- applies to every new write/update immediately. The current repository never wrote
-- secrets to config, so the constraint can be validated against existing rows too.
ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_config_contains_no_secrets;
ALTER TABLE finnor_os.tenant_integrations
  ADD CONSTRAINT tenant_integrations_config_contains_no_secrets CHECK (
    config::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential)[^"]*"[[:space:]]*:'
  );

ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_metadata_contains_no_secrets;
ALTER TABLE finnor_os.tenant_integrations
  ADD CONSTRAINT tenant_integrations_metadata_contains_no_secrets CHECK (
    credential_metadata::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential)[^"]*"[[:space:]]*:'
  );

CREATE INDEX IF NOT EXISTS tenant_integrations_tenant_binding_idx
  ON finnor_os.tenant_integrations (tenant_id, binding);
