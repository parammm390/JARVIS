-- Every message/call Finnor "sends" while real carriers (GHL SMS, Vapi PSTN) are not
-- yet connected lands here — real, observable, tenant-scoped. When carriers connect,
-- the same tool names route to the real drivers and this table stops growing.
CREATE TABLE IF NOT EXISTS finnor_os.sandbox_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  channel text NOT NULL CHECK (channel IN ('sms','call','email')),
  to_number text NOT NULL,
  content text NOT NULL,
  simulated boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE finnor_os.sandbox_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.sandbox_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.sandbox_outbox;
CREATE POLICY tenant_isolation ON finnor_os.sandbox_outbox
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT ON finnor_os.sandbox_outbox TO finnor_app;
  END IF;
END $do$;
