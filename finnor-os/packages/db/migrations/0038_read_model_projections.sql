-- B1.T3 — CQRS materialized cache for the 3 hottest read-models (pipeline-health,
-- reliability, activity-snapshot). One row per (tenant, view); packages/projections
-- recomputes and upserts it whenever B1.T1's jarvis_events NOTIFY signals a change
-- relevant to that view (debounced), and on cold-start/missing-row self-heals by
-- computing live. The other 9 views named in the plan stay pure query-time — no cache
-- row for them.
CREATE TABLE IF NOT EXISTS finnor_os.read_model_projections (
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  view text NOT NULL CHECK (view IN ('pipeline-health', 'reliability', 'activity-snapshot')),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, view)
);

DO $do$
BEGIN
  ALTER TABLE finnor_os.read_model_projections ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.read_model_projections FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.read_model_projections;
  CREATE POLICY tenant_isolation ON finnor_os.read_model_projections
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.read_model_projections TO finnor_app;
  END IF;
END $do$;
