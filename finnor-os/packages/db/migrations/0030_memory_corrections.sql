-- Phase 5 (§5.6 — JARVIS 95% MAESTRO PACK): correction loop. An operator-supplied
-- correction to a wrong AI answer, linked back to the real DecisionReceipt for the
-- answer being corrected (real provenance, not a free-floating claim) — stored as a
-- first-class fact that outranks semantic hits on the same topic thereafter.
CREATE TABLE IF NOT EXISTS finnor_os.memory_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  receipt_id uuid REFERENCES finnor_os.decision_receipts(id),
  question text NOT NULL,
  wrong_answer text NOT NULL,
  corrected_fact text NOT NULL,
  corrected_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memory_corrections_tenant_idx ON finnor_os.memory_corrections (tenant_id);

DO $do$
BEGIN
  ALTER TABLE finnor_os.memory_corrections ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.memory_corrections FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.memory_corrections;
  CREATE POLICY tenant_isolation ON finnor_os.memory_corrections
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.memory_corrections TO finnor_app;
  END IF;
END $do$;
