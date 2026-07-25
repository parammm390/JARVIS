-- A5.T2: Preview schema verification found a recorded-but-missing 0006 table.
-- Reassert this global rate-limit table idempotently so the authenticated tenant
-- probe exercises the actual route instead of failing before its RLS read.
CREATE TABLE IF NOT EXISTS finnor_os.api_rate_limits (
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (bucket_key, window_started_at)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx ON finnor_os.api_rate_limits (window_started_at);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.api_rate_limits TO finnor_app;
  END IF;
END $do$;
