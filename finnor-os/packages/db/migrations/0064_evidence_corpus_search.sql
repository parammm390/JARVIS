-- JARVIS evidence corpus: source-backed research material is additive to the
-- immutable business_events operational ledger and to semantic memory.
--
-- `scope='tenant'` rows are owned by tenant_id. `scope='public'` rows are a
-- deliberately ownerless, cacheable public corpus; RLS permits reading them from
-- a tenant context but never makes a tenant-owned row public.

CREATE TABLE IF NOT EXISTS finnor_os.evidence_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'tenant' CHECK (scope IN ('tenant', 'public')),
  tenant_id uuid REFERENCES finnor_os.tenants(id),
  source_key text NOT NULL,
  source_type text NOT NULL,
  canonical_url text,
  title text NOT NULL,
  publisher text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR (scope = 'public' AND tenant_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS evidence_sources_tenant_key_idx
  ON finnor_os.evidence_sources (tenant_id, source_key) WHERE scope = 'tenant';
CREATE UNIQUE INDEX IF NOT EXISTS evidence_sources_public_key_idx
  ON finnor_os.evidence_sources (source_key) WHERE scope = 'public';
CREATE INDEX IF NOT EXISTS evidence_sources_scope_idx
  ON finnor_os.evidence_sources (scope, tenant_id);

CREATE TABLE IF NOT EXISTS finnor_os.evidence_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES finnor_os.evidence_sources(id),
  scope text NOT NULL CHECK (scope IN ('tenant', 'public')),
  tenant_id uuid REFERENCES finnor_os.tenants(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content text NOT NULL CHECK (char_length(content) > 0),
  snapshot jsonb NOT NULL DEFAULT '{}',
  as_of timestamptz NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, version_number),
  UNIQUE (source_id, content_hash),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR (scope = 'public' AND tenant_id IS NULL))
);
CREATE INDEX IF NOT EXISTS evidence_source_versions_scope_asof_idx
  ON finnor_os.evidence_source_versions (scope, tenant_id, as_of);

-- The generated tsvector makes lexical retrieval indexable while keeping source
-- content immutable. The embedding column is added conditionally for local Postgres
-- installations that do not have pgvector, matching the existing memory fallback.
CREATE TABLE IF NOT EXISTS finnor_os.evidence_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES finnor_os.evidence_sources(id),
  version_id uuid NOT NULL REFERENCES finnor_os.evidence_source_versions(id),
  scope text NOT NULL CHECK (scope IN ('tenant', 'public')),
  tenant_id uuid REFERENCES finnor_os.tenants(id),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 24000),
  token_count integer NOT NULL CHECK (token_count BETWEEN 1 AND 600),
  entity_refs jsonb NOT NULL DEFAULT '[]',
  time_refs jsonb NOT NULL DEFAULT '[]',
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, ordinal),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR (scope = 'public' AND tenant_id IS NULL))
);
DO $embedding$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE finnor_os.evidence_chunks ADD COLUMN IF NOT EXISTS embedding vector(1024)';
  ELSE
    EXECUTE 'ALTER TABLE finnor_os.evidence_chunks ADD COLUMN IF NOT EXISTS embedding jsonb';
  END IF;
END $embedding$;
CREATE INDEX IF NOT EXISTS evidence_chunks_scope_idx
  ON finnor_os.evidence_chunks (scope, tenant_id, version_id);
CREATE INDEX IF NOT EXISTS evidence_chunks_fts_idx
  ON finnor_os.evidence_chunks USING gin (search_vector);
DO $vector_index$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS evidence_chunks_embedding_hnsw_idx ON finnor_os.evidence_chunks USING hnsw (embedding vector_cosine_ops)';
  END IF;
END $vector_index$;

CREATE TABLE IF NOT EXISTS finnor_os.research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  query text NOT NULL,
  as_of timestamptz NOT NULL,
  search_config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS research_runs_tenant_started_idx
  ON finnor_os.research_runs (tenant_id, started_at DESC);

-- A materialized hit keeps the exact excerpt and ranking inputs used for a research
-- answer, rather than relying on a later re-run over mutable search configuration.
CREATE TABLE IF NOT EXISTS finnor_os.research_run_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  research_run_id uuid NOT NULL REFERENCES finnor_os.research_runs(id),
  source_id uuid NOT NULL REFERENCES finnor_os.evidence_sources(id),
  version_id uuid NOT NULL REFERENCES finnor_os.evidence_source_versions(id),
  chunk_id uuid NOT NULL REFERENCES finnor_os.evidence_chunks(id),
  scope text NOT NULL CHECK (scope IN ('tenant', 'public')),
  rank integer NOT NULL CHECK (rank > 0),
  fused_score real NOT NULL,
  lexical_score real,
  vector_score real,
  excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_run_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS research_run_hits_tenant_run_idx
  ON finnor_os.research_run_hits (tenant_id, research_run_id, rank);

-- A row's denormalized scope/tenant pair is part of the security boundary. These
-- checks prevent a caller who knows another tenant's UUID from attaching a private
-- version/chunk to a row in its own namespace, while still allowing a tenant run to
-- cite an ownerless public chunk.
CREATE OR REPLACE FUNCTION finnor_os.assert_evidence_parent_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_scope text;
  parent_tenant uuid;
  parent_source_id uuid;
  parent_version_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'evidence_source_versions' THEN
    SELECT scope, tenant_id INTO parent_scope, parent_tenant
    FROM finnor_os.evidence_sources WHERE id = NEW.source_id;
  ELSIF TG_TABLE_NAME = 'evidence_chunks' THEN
    SELECT scope, tenant_id INTO parent_scope, parent_tenant
    FROM finnor_os.evidence_sources WHERE id = NEW.source_id;
    IF NOT EXISTS (
      SELECT 1 FROM finnor_os.evidence_source_versions
      WHERE id = NEW.version_id AND source_id = NEW.source_id
        AND scope = NEW.scope AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'evidence chunk version does not match its source scope';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM finnor_os.research_runs
      WHERE id = NEW.research_run_id AND tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'research hit does not belong to the requesting tenant';
    END IF;
    SELECT scope, tenant_id, source_id, version_id
      INTO parent_scope, parent_tenant, parent_source_id, parent_version_id
    FROM finnor_os.evidence_chunks WHERE id = NEW.chunk_id;
    IF parent_source_id IS DISTINCT FROM NEW.source_id OR parent_version_id IS DISTINCT FROM NEW.version_id THEN
      RAISE EXCEPTION 'research hit does not match its evidence chunk';
    END IF;
  END IF;

  IF parent_scope IS NULL OR parent_scope <> NEW.scope
     OR (NEW.scope = 'tenant' AND parent_tenant IS DISTINCT FROM NEW.tenant_id)
     OR (NEW.scope = 'public' AND parent_tenant IS NOT NULL) THEN
    RAISE EXCEPTION 'evidence row scope does not match its parent';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finnor_os.freeze_evidence_source_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.scope <> NEW.scope OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'evidence source scope is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS evidence_sources_scope_immutable ON finnor_os.evidence_sources;
CREATE TRIGGER evidence_sources_scope_immutable
  BEFORE UPDATE ON finnor_os.evidence_sources
  FOR EACH ROW EXECUTE FUNCTION finnor_os.freeze_evidence_source_scope();
DROP TRIGGER IF EXISTS evidence_source_versions_parent_scope ON finnor_os.evidence_source_versions;
CREATE TRIGGER evidence_source_versions_parent_scope
  BEFORE INSERT ON finnor_os.evidence_source_versions
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_evidence_parent_scope();
DROP TRIGGER IF EXISTS evidence_chunks_parent_scope ON finnor_os.evidence_chunks;
CREATE TRIGGER evidence_chunks_parent_scope
  BEFORE INSERT ON finnor_os.evidence_chunks
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_evidence_parent_scope();
DROP TRIGGER IF EXISTS research_run_hits_parent_scope ON finnor_os.research_run_hits;
CREATE TRIGGER research_run_hits_parent_scope
  BEFORE INSERT ON finnor_os.research_run_hits
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_evidence_parent_scope();

-- Public cache rows are readable in a tenant context, but only tenant-owned rows
-- are writable through the normal application role. A privileged cache-ingestion
-- process may populate public rows; tenant requests cannot write globally visible
-- data. The scope/tenant checks above make the two namespaces disjoint at the row
-- level.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['evidence_sources', 'evidence_source_versions', 'evidence_chunks'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS evidence_scope_read ON finnor_os.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS evidence_tenant_insert ON finnor_os.%I', table_name);
    EXECUTE format('DROP POLICY IF EXISTS evidence_tenant_update ON finnor_os.%I', table_name);
    EXECUTE format(
      'CREATE POLICY evidence_scope_read ON finnor_os.%I FOR SELECT
       USING (scope = ''public'' OR tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY evidence_tenant_insert ON finnor_os.%I FOR INSERT
       WITH CHECK (scope = ''tenant'' AND tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY evidence_tenant_update ON finnor_os.%I FOR UPDATE
       USING (scope = ''tenant'' AND tenant_id = finnor_os.request_tenant_id())
       WITH CHECK (scope = ''tenant'' AND tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY['research_runs', 'research_run_hits'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON finnor_os.%I
       USING (tenant_id = finnor_os.request_tenant_id())
       WITH CHECK (tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.evidence_sources TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.evidence_source_versions TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.evidence_chunks TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.research_runs TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.research_run_hits TO finnor_app;
  END IF;
END $rls$;

-- Versions, chunks, and recorded hits are historical evidence. Source metadata and
-- research-run status remain mutable lifecycle records; the corpus itself does not.
CREATE OR REPLACE FUNCTION finnor_os.forbid_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence corpus rows are append-only';
END $$;
DROP TRIGGER IF EXISTS evidence_source_versions_immutable ON finnor_os.evidence_source_versions;
CREATE TRIGGER evidence_source_versions_immutable
  BEFORE UPDATE OR DELETE ON finnor_os.evidence_source_versions
  FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_evidence_mutation();
DROP TRIGGER IF EXISTS evidence_chunks_immutable ON finnor_os.evidence_chunks;
CREATE TRIGGER evidence_chunks_immutable
  BEFORE UPDATE OR DELETE ON finnor_os.evidence_chunks
  FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_evidence_mutation();
DROP TRIGGER IF EXISTS research_run_hits_immutable ON finnor_os.research_run_hits;
CREATE TRIGGER research_run_hits_immutable
  BEFORE UPDATE OR DELETE ON finnor_os.research_run_hits
  FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_evidence_mutation();
