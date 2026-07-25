-- B4.T4: report-only comparison of a read-only Dealer Zero intake mirror and a
-- staging candidate. This table stores contracts, never credentials or source rows.
CREATE TABLE IF NOT EXISTS finnor_os.dealer_zero_shadow_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  observation_started_at timestamptz NOT NULL,
  observation_ended_at timestamptz NOT NULL,
  source_label text NOT NULL,
  candidate_label text NOT NULL,
  source_snapshot jsonb NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  diff jsonb NOT NULL,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (observation_ended_at >= observation_started_at)
);
CREATE INDEX IF NOT EXISTS dealer_zero_shadow_reports_tenant_created_idx ON finnor_os.dealer_zero_shadow_reports(tenant_id, created_at DESC);
ALTER TABLE finnor_os.dealer_zero_shadow_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.dealer_zero_shadow_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.dealer_zero_shadow_reports;
CREATE POLICY tenant_isolation ON finnor_os.dealer_zero_shadow_reports USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DO $do$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.dealer_zero_shadow_reports TO finnor_app; END IF; END $do$;
