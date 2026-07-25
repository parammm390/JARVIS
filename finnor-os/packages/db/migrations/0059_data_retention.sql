-- B7.T2: tenant-configurable retention with a conservative 90-day default.
-- Immutable action_log/business_events and decision receipts are intentionally absent.
CREATE TABLE IF NOT EXISTS finnor_os.tenant_data_retention_policies (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 30 AND 3650),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS finnor_os.data_retention_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  resource_type text NOT NULL CHECK (resource_type IN ('call','message','job')),
  resource_id uuid NOT NULL,
  reason text NOT NULL,
  held_by uuid REFERENCES finnor_os.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (tenant_id, resource_type, resource_id)
);
ALTER TABLE finnor_os.jobs ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE finnor_os.tenant_data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_data_retention_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.data_retention_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.data_retention_holds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_data_retention_policies;
CREATE POLICY tenant_isolation ON finnor_os.tenant_data_retention_policies USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.data_retention_holds;
CREATE POLICY tenant_isolation ON finnor_os.data_retention_holds USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.tenant_data_retention_policies, finnor_os.data_retention_holds TO finnor_app;
  END IF;
END $do$;
