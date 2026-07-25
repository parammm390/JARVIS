-- B4.T3: durable, tenant-scoped Dealer Zero day recordings and normalized replay
-- reports. The payloads are synthetic simulation plans / receipt contracts only.
CREATE TABLE IF NOT EXISTS finnor_os.dealer_zero_replay_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  date_seed date NOT NULL,
  scenario text NOT NULL CHECK (scenario IN ('normal_day','brutal_summer','payment_crunch','equipment_recall','chaos_day')),
  event_stream jsonb NOT NULL,
  receipt_snapshot jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, date_seed, scenario)
);
CREATE INDEX IF NOT EXISTS dealer_zero_replay_recordings_tenant_created_idx
  ON finnor_os.dealer_zero_replay_recordings(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.dealer_zero_replay_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  recording_id uuid NOT NULL REFERENCES finnor_os.dealer_zero_replay_recordings(id),
  candidate_label text NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  diff jsonb NOT NULL,
  passed boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dealer_zero_replay_reports_recording_created_idx
  ON finnor_os.dealer_zero_replay_reports(recording_id, created_at DESC);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dealer_zero_replay_recordings','dealer_zero_replay_reports'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I; CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id())', t, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.%I TO finnor_app', t);
    END IF;
  END LOOP;
END $do$;
