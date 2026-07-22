-- A3.T1 (§4 Integration Registry & Provider Hardening): per-tenant override for which
-- binding serves each capability, on top of A1.T3's env-only resolveCapabilityBindings().
-- Resolution order becomes tenant-row -> env -> A1 defaults (packages/tools/src/
-- binding-resolution.ts's resolveOwned/resolveExternal already ARE the env->default
-- half of that chain -- this table adds the first, most-specific link). One row per
-- (tenant, capability); missing row means "no tenant override, fall through to env."
--
-- mode is a separate axis from binding: binding is WHICH implementation
-- (native/ghl/vapi/docusign/quickbooks/stripe/dry_run/emulator), mode is HOW SERIOUSLY
-- to treat it (a real vendor account, a vendor's own sandbox/test-mode account, or our
-- in-repo emulator) -- matches §8's payments/e-sign sandbox-mode plan and keeps
-- "sandbox" from ever being confused with "real" in the UI (hard rule #7, honest
-- spectacle).
CREATE TABLE IF NOT EXISTS finnor_os.tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  capability text NOT NULL CHECK (capability IN ('scheduling','documents','inventory','crm','communications','esign','accounting','payments','marketing')),
  binding text NOT NULL,
  mode text NOT NULL DEFAULT 'emulator' CHECK (mode IN ('real','sandbox','emulator')),
  config jsonb NOT NULL DEFAULT '{}',
  health text NOT NULL DEFAULT 'unknown' CHECK (health IN ('ok','degraded','down','unknown')),
  last_check_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, capability)
);
CREATE INDEX IF NOT EXISTS tenant_integrations_tenant_idx ON finnor_os.tenant_integrations (tenant_id);

DO $do$
BEGIN
  ALTER TABLE finnor_os.tenant_integrations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.tenant_integrations FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_integrations;
  CREATE POLICY tenant_isolation ON finnor_os.tenant_integrations
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.tenant_integrations TO finnor_app;
  END IF;
END $do$;
