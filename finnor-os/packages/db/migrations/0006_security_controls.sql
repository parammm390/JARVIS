-- Production security controls: distributed API limits, replay receipts, and a
-- durable idempotency ledger for externally-visible tool calls.

CREATE TABLE IF NOT EXISTS finnor_os.api_rate_limits (
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (bucket_key, window_started_at)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx ON finnor_os.api_rate_limits (window_started_at);

CREATE TABLE IF NOT EXISTS finnor_os.webhook_receipts (
  provider text NOT NULL,
  event_id text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_receipts_received_at_idx ON finnor_os.webhook_receipts (received_at);

CREATE TABLE IF NOT EXISTS finnor_os.external_operations (
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL REFERENCES finnor_os.domain_actions(id),
  operation_key text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (domain_action_id, operation_key)
);
CREATE INDEX IF NOT EXISTS external_operations_tenant_idx ON finnor_os.external_operations (tenant_id, updated_at);

ALTER TABLE finnor_os.external_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.external_operations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.external_operations;
CREATE POLICY tenant_isolation ON finnor_os.external_operations
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.external_operations TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.api_rate_limits TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.webhook_receipts TO finnor_app;
  END IF;
END $do$;
