-- Phase 3: declarative, tenant-scoped client data imports.
-- Canonical business rows remain in their existing tables and are written through
-- @finnor/data-platform. These tables are only durable import identity/audit state.

ALTER TABLE finnor_os.contacts ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE finnor_os.contacts ADD COLUMN IF NOT EXISTS last_name text;

CREATE TABLE IF NOT EXISTS finnor_os.import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  definition_key text NOT NULL,
  definition_version integer NOT NULL CHECK (definition_version > 0),
  source_system text NOT NULL,
  source_name text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  definition_sha256 text NOT NULL CHECK (definition_sha256 ~ '^[0-9a-f]{64}$'),
  dry_run boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','completed_with_errors','failed')),
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  created_rows integer NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  updated_rows integer NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  skipped_rows integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  quarantined_rows integer NOT NULL DEFAULT 0 CHECK (quarantined_rows >= 0),
  report jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(report) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS import_runs_tenant_started_idx ON finnor_os.import_runs(tenant_id, started_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  run_id uuid NOT NULL REFERENCES finnor_os.import_runs(id),
  row_number integer NOT NULL CHECK (row_number > 0),
  source_id text,
  identity_key text,
  status text NOT NULL CHECK (status IN ('planned','created','updated','skipped','quarantined')),
  canonical_entity_type text,
  canonical_entity_id uuid,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(normalized_data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, row_number)
);
CREATE INDEX IF NOT EXISTS import_rows_tenant_status_idx ON finnor_os.import_rows(tenant_id, status);

CREATE TABLE IF NOT EXISTS finnor_os.import_entity_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  source_system text NOT NULL,
  entity_type text NOT NULL,
  source_id text NOT NULL,
  canonical_entity_id uuid NOT NULL,
  identity_key text,
  first_run_id uuid NOT NULL REFERENCES finnor_os.import_runs(id),
  last_run_id uuid NOT NULL REFERENCES finnor_os.import_runs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, entity_type, source_id)
);
CREATE INDEX IF NOT EXISTS import_entity_refs_identity_idx ON finnor_os.import_entity_refs(tenant_id, source_system, entity_type, identity_key);

CREATE OR REPLACE FUNCTION finnor_os.import_entity_tenant(p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE resolved uuid;
BEGIN
  IF p_type = 'inventory_item' THEN
    SELECT tenant_id INTO resolved FROM finnor_os.inventory_items WHERE id=p_id;
  ELSE
    resolved := finnor_os.canonical_entity_tenant(p_type, p_id);
  END IF;
  RETURN resolved;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.import_entity_tenant(text,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.assert_import_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'import_rows' THEN
    SELECT tenant_id INTO related_tenant FROM finnor_os.import_runs WHERE id=NEW.run_id;
    IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'import row crosses tenant boundary'; END IF;
    IF NEW.canonical_entity_id IS NOT NULL AND finnor_os.import_entity_tenant(NEW.canonical_entity_type, NEW.canonical_entity_id) IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'import row canonical entity crosses tenant boundary or is missing';
    END IF;
  ELSIF TG_TABLE_NAME = 'import_entity_refs' THEN
    SELECT tenant_id INTO related_tenant FROM finnor_os.import_runs WHERE id=NEW.first_run_id;
    IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'import reference first run crosses tenant boundary'; END IF;
    SELECT tenant_id INTO related_tenant FROM finnor_os.import_runs WHERE id=NEW.last_run_id;
    IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'import reference last run crosses tenant boundary'; END IF;
    IF finnor_os.import_entity_tenant(NEW.entity_type, NEW.canonical_entity_id) IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'import reference canonical entity crosses tenant boundary or is missing';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_import_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS import_rows_scope ON finnor_os.import_rows;
CREATE TRIGGER import_rows_scope BEFORE INSERT OR UPDATE ON finnor_os.import_rows
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_import_scope();
DROP TRIGGER IF EXISTS import_entity_refs_scope ON finnor_os.import_entity_refs;
CREATE TRIGGER import_entity_refs_scope BEFORE INSERT OR UPDATE ON finnor_os.import_entity_refs
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_import_scope();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['import_runs','import_rows','import_entity_refs'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.import_runs TO finnor_app;
    GRANT SELECT,INSERT ON finnor_os.import_rows TO finnor_app;
    GRANT SELECT,INSERT,UPDATE ON finnor_os.import_entity_refs TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.import_entity_tenant(text,uuid),finnor_os.assert_import_scope() TO finnor_app;
    REVOKE DELETE ON finnor_os.import_runs,finnor_os.import_rows,finnor_os.import_entity_refs FROM finnor_app;
  END IF;
END $rls$;
