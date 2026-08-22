-- A real managed-secret backend for local/staging canaries on macOS. Runtime access
-- is additionally gated by FINNOR_ENVIRONMENT=staging and an explicit opt-in; normal
-- production remains AWS Secrets Manager only. The database stores an opaque,
-- tenant-scoped Keychain service reference, never a secret value.

ALTER TABLE finnor_os.auth_profiles
  DROP CONSTRAINT IF EXISTS auth_profiles_credential_contract_check;
ALTER TABLE finnor_os.auth_profiles
  ADD CONSTRAINT auth_profiles_credential_contract_check CHECK (
    (credential_provider IS NULL AND credential_ref IS NULL AND credential_version IS NULL)
    OR (credential_provider='aws-secrets-manager' AND credential_ref IS NOT NULL
        AND btrim(credential_ref)<>'' AND position(tenant_id::text IN credential_ref)>0
        AND (credential_version IS NULL OR btrim(credential_version)<>''))
    OR (credential_provider='os-keychain' AND credential_ref IS NOT NULL
        AND credential_ref LIKE 'finnor/tenants/'||tenant_id::text||'/%'
        AND credential_version IS NULL)
    OR (credential_provider='legacy-env' AND credential_ref ~ '^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|gmail|resend|meta_ads|google_ads)$'
        AND credential_version IS NULL)
  );
