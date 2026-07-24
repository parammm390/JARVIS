-- B3.T2: explicit, tenant-scoped inputs for explainable appointment-slot scoring.
-- All values are nullable: a missing dealer configuration must produce a visible
-- unavailable recommendation, never a fictional technician location or SLA.
CREATE TABLE IF NOT EXISTS finnor_os.technician_dispatch_profiles (
  technician_id uuid PRIMARY KEY REFERENCES finnor_os.technicians(id),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  base_address text,
  workday_start text,
  workday_end text,
  default_sla_minutes integer CHECK (default_sla_minutes > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS technician_dispatch_profiles_tenant_idx
  ON finnor_os.technician_dispatch_profiles(tenant_id);

ALTER TABLE finnor_os.technician_dispatch_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.technician_dispatch_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.technician_dispatch_profiles;
CREATE POLICY tenant_isolation ON finnor_os.technician_dispatch_profiles
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.technician_dispatch_profiles TO finnor_app;
  END IF;
END $do$;
