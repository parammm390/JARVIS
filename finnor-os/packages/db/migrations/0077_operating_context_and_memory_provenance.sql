-- Production hardening: stable operating profiles plus provenance-aware memory.
-- Additive only.  Existing semantic rows remain inspectable; exact duplicates are
-- marked superseded rather than deleted.

CREATE TABLE IF NOT EXISTS finnor_os.tenant_operating_profiles (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  industry text,
  niche text,
  description text,
  primary_geographies jsonb NOT NULL DEFAULT '[]'::jsonb,
  founded_year integer CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2200),
  ideal_customer_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(primary_geographies) = 'array'),
  CHECK (jsonb_typeof(ideal_customer_profile) = 'object'),
  CHECK (jsonb_typeof(business_facts) = 'object'),
  CHECK (jsonb_typeof(comparison_defaults) = 'object')
);

CREATE TABLE IF NOT EXISTS finnor_os.user_operating_profiles (
  user_id uuid PRIMARY KEY REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  title text,
  profile_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(profile_facts) = 'object')
);
CREATE INDEX IF NOT EXISTS user_operating_profiles_tenant_idx
  ON finnor_os.user_operating_profiles(tenant_id);

-- Create honest empty records for existing identities.  This does not infer or
-- hardcode a company/user fact; null/empty fields remain visibly incomplete.
INSERT INTO finnor_os.tenant_operating_profiles (tenant_id)
SELECT id FROM finnor_os.tenants
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO finnor_os.user_operating_profiles (user_id, tenant_id)
SELECT id, tenant_id FROM finnor_os.users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE finnor_os.tenant_operating_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_operating_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_operating_profiles;
CREATE POLICY tenant_isolation ON finnor_os.tenant_operating_profiles
USING (tenant_id = finnor_os.request_tenant_id())
WITH CHECK (tenant_id = finnor_os.request_tenant_id());

ALTER TABLE finnor_os.user_operating_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.user_operating_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_operating_profile_isolation ON finnor_os.user_operating_profiles;
CREATE POLICY user_operating_profile_isolation ON finnor_os.user_operating_profiles
USING (
  tenant_id = finnor_os.request_tenant_id()
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
)
WITH CHECK (
  tenant_id = finnor_os.request_tenant_id()
  AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'semantic_history';
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES finnor_os.embeddings(id);
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

UPDATE finnor_os.embeddings
SET content_hash = encode(digest(chunk, 'sha256'), 'hex')
WHERE content_hash IS NULL;
ALTER TABLE finnor_os.embeddings ALTER COLUMN content_hash SET NOT NULL;

-- Keep the newest exact row active and retain every older duplicate as explicit
-- historical/superseded evidence.  No semantic-memory row is deleted.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, source_doc_id, content_hash
           ORDER BY occurred_at DESC, id DESC
         ) AS ordinal
  FROM finnor_os.embeddings
  WHERE superseded_at IS NULL
)
UPDATE finnor_os.embeddings AS e
SET superseded_at = now()
FROM ranked
WHERE ranked.id = e.id AND ranked.ordinal > 1;

CREATE UNIQUE INDEX IF NOT EXISTS embeddings_active_source_hash_idx
  ON finnor_os.embeddings(tenant_id, source_doc_id, content_hash)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS embeddings_tenant_active_idx
  ON finnor_os.embeddings(tenant_id, source_doc_id, superseded_at);
CREATE INDEX IF NOT EXISTS embeddings_entity_refs_gin_idx
  ON finnor_os.embeddings USING gin(entity_refs);

ALTER TABLE finnor_os.memory_corrections ADD COLUMN IF NOT EXISTS supersedes_id uuid REFERENCES finnor_os.memory_corrections(id);
ALTER TABLE finnor_os.memory_corrections ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, question
           ORDER BY created_at DESC, id DESC
         ) AS ordinal
  FROM finnor_os.memory_corrections
  WHERE superseded_at IS NULL
)
UPDATE finnor_os.memory_corrections AS correction
SET superseded_at = now()
FROM ranked
WHERE ranked.id = correction.id AND ranked.ordinal > 1;
CREATE INDEX IF NOT EXISTS memory_corrections_active_idx
  ON finnor_os.memory_corrections(tenant_id, superseded_at);
CREATE UNIQUE INDEX IF NOT EXISTS memory_corrections_active_question_idx
  ON finnor_os.memory_corrections(tenant_id, question)
  WHERE superseded_at IS NULL;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.tenant_operating_profiles TO finnor_app;
    GRANT SELECT, INSERT, UPDATE ON finnor_os.user_operating_profiles TO finnor_app;
    REVOKE DELETE ON finnor_os.tenant_operating_profiles FROM finnor_app;
    REVOKE DELETE ON finnor_os.user_operating_profiles FROM finnor_app;
  END IF;
END $grants$;
