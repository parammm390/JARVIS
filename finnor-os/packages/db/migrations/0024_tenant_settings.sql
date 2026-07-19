-- Phase 3 (§3.2/§3.3): one row of real per-tenant flags. is_dealer_zero is the
-- durable "labeled dealer-zero everywhere" truth other code checks (public/demo pages,
-- the life simulator, admin views) instead of string-matching a tenant name.
-- simulator_enabled is §3.3's gate — ON only for Dealer Zero, never toggled by a code
-- path that isn't this table.

CREATE TABLE IF NOT EXISTS finnor_os.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  is_dealer_zero boolean NOT NULL DEFAULT false,
  simulator_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $do$
BEGIN
  ALTER TABLE finnor_os.tenant_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.tenant_settings FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_settings;
  CREATE POLICY tenant_isolation ON finnor_os.tenant_settings
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.tenant_settings TO finnor_app;
  END IF;
END $do$;
