-- Phase 4 (§4.2/§4.5): two tables.
--
-- document_contents: real PDF bytes, Postgres-backed (no blob-storage account exists
-- or is in scope this phase) -- separate from documents' metadata row, same
-- convention as decision_receipts living apart from workflow_steps. One row per
-- document; content is immutable once written (a re-generation with the same
-- idempotency key is a no-op at the capability layer, never an in-place edit here).
--
-- external_refs: the single join between a Finnor-internal entity and a real
-- provider's object, once Phase 4's provider bindings start flipping from emulator to
-- real (GHL contacts, QuickBooks customers/invoices, Stripe payment links, DocuSign
-- envelopes, Vapi call ids). No provider ids scattered across domain tables.

CREATE TABLE IF NOT EXISTS finnor_os.document_contents (
  document_id uuid PRIMARY KEY REFERENCES finnor_os.documents(id),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  content_type text NOT NULL DEFAULT 'application/pdf',
  bytes bytea NOT NULL,
  size_bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.external_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  entity text NOT NULL, -- e.g. "household", "invoice", "proposal", "appointment"
  internal_id uuid NOT NULL,
  provider text NOT NULL, -- e.g. "ghl", "quickbooks", "stripe", "docusign", "vapi"
  external_id text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS external_refs_internal_provider_idx
  ON finnor_os.external_refs (tenant_id, entity, internal_id, provider);
CREATE INDEX IF NOT EXISTS external_refs_external_id_idx
  ON finnor_os.external_refs (tenant_id, provider, external_id);

DO $do$
BEGIN
  ALTER TABLE finnor_os.document_contents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.document_contents FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.document_contents;
  CREATE POLICY tenant_isolation ON finnor_os.document_contents
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());

  ALTER TABLE finnor_os.external_refs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.external_refs FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.external_refs;
  CREATE POLICY tenant_isolation ON finnor_os.external_refs
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.document_contents TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.external_refs TO finnor_app;
  END IF;
END $do$;
