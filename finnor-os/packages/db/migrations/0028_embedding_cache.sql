-- Phase 5 (§5.1): content-hash embedding cache so re-ingesting an unchanged chunk never
-- pays for a second embedding call. Tenant-scoped, deliberately NOT a global cache: a
-- shared cache would let one tenant's request implicitly reveal whether another tenant
-- had ever embedded byte-identical text (which can contain PII — a customer's exact
-- name+phone string) purely via cache-hit behavior. Keyed by (tenant_id, content_hash,
-- model) so a future provider/model change never serves a stale-dimension vector back
-- from a retired model. Mirrors migration 0000's pgvector-present-or-jsonb-fallback
-- branch for dev machines without the extension.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS finnor_os.embedding_cache (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
      content_hash text NOT NULL,
      model text NOT NULL,
      embedding vector(1024) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, content_hash, model)
    )';
  ELSE
    EXECUTE 'CREATE TABLE IF NOT EXISTS finnor_os.embedding_cache (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
      content_hash text NOT NULL,
      model text NOT NULL,
      embedding jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, content_hash, model)
    )';
  END IF;
END $do$;
CREATE INDEX IF NOT EXISTS embedding_cache_tenant_idx ON finnor_os.embedding_cache (tenant_id);

DO $do$
BEGIN
  ALTER TABLE finnor_os.embedding_cache ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.embedding_cache FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.embedding_cache;
  CREATE POLICY tenant_isolation ON finnor_os.embedding_cache
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.embedding_cache TO finnor_app;
  END IF;
END $do$;
