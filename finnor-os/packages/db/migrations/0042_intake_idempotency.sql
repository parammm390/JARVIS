-- A4.T6 (JARVIS MAESTRO PLAN §4/A4): opt-in idempotency for POST /api/actions (the
-- instruction intake path). `response` starts NULL at claim time (the row IS the claim
-- — a second INSERT for the same (tenant_id, idempotency_key) conflicts and is rejected
-- BEFORE the orchestrator ever runs a second time), then gets filled in once the real
-- planner run completes. Distinct from commands.idempotency_key (workflow-runtime's own,
-- unrelated to the LLM planner's intake) and from tenant_integrations' per-tenant style —
-- this one's job is purely "did this exact retried submission already happen."
CREATE TABLE IF NOT EXISTS finnor_os.intake_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  idempotency_key text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS intake_idempotency_tenant_idx ON finnor_os.intake_idempotency (tenant_id);

DO $do$
BEGIN
  ALTER TABLE finnor_os.intake_idempotency ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.intake_idempotency FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.intake_idempotency;
  CREATE POLICY tenant_isolation ON finnor_os.intake_idempotency
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.intake_idempotency TO finnor_app;
  END IF;
END $do$;
