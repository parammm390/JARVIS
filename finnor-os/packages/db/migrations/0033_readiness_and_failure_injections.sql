-- Phase 8 (§8.2 failure-injection calendar, §8.3 daily scorecard): two new,
-- tenant-scoped, RLS'd tables — matching migration 0016's exact convention.

CREATE TABLE IF NOT EXISTS finnor_os.readiness_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  log_date date NOT NULL,
  workflow_success_rate real,
  step_latency_p95_ms integer,
  retry_rate real,
  human_intervention_rate real,
  reconciliation_backlog integer NOT NULL,
  dlq_depth integer NOT NULL,
  receipt_completeness real,
  incident_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, log_date)
);
CREATE INDEX IF NOT EXISTS readiness_log_tenant_date_idx ON finnor_os.readiness_log (tenant_id, log_date);

CREATE TABLE IF NOT EXISTS finnor_os.failure_injections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  kind text NOT NULL CHECK (kind IN ('worker_kill','webhook_replay','provider_egress_block','approval_expiry_pileup','secrets_store_hiccup','deploy_mid_workflow')),
  injected_at timestamptz NOT NULL DEFAULT now(),
  detected_at timestamptz,
  recovered_at timestamptz,
  outcome text CHECK (outcome IN ('pass','fail','inconclusive')),
  detail jsonb NOT NULL DEFAULT '{}',
  receipt_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS failure_injections_tenant_injected_idx ON finnor_os.failure_injections (tenant_id, injected_at);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['readiness_log','failure_injections'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I;
       CREATE POLICY tenant_isolation ON finnor_os.%I
         USING (tenant_id = finnor_os.request_tenant_id())
         WITH CHECK (tenant_id = finnor_os.request_tenant_id())', t, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.%I TO finnor_app', t);
    END IF;
  END LOOP;
END $do$;
