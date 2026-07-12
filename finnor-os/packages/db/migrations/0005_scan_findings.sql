-- Proactive scan findings: a lightweight staging area for the owner digest.
-- Scans with no natural mutating action to draft into (low inventory, service-due)
-- write here instead of inventing a bespoke action_type per category; the daily
-- digest job reads undigested rows, speaks/logs them, and marks them digested.
-- No scheduling-decision race risk here (unlike jobs.run_at) — inserts are always
-- valid, there's no "is it time" decision to get wrong under concurrent writers.

CREATE TABLE IF NOT EXISTS finnor_os.scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  scan_type text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  digested_at timestamptz
);

CREATE INDEX IF NOT EXISTS scan_findings_tenant_undigested_idx
  ON finnor_os.scan_findings (tenant_id, digested_at)
  WHERE digested_at IS NULL;

ALTER TABLE finnor_os.scan_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.scan_findings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.scan_findings;
CREATE POLICY tenant_isolation ON finnor_os.scan_findings
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.scan_findings TO finnor_app;
  END IF;
END $do$;
