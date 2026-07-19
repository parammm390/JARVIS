-- Phase 5 (§5.1, §5.2 — JARVIS 95% MAESTRO PACK): Voyage AI voyage-3.5 embeds at 1024
-- dimensions, not the 1536 placeholder this table was created with before a real
-- provider was chosen (packages/memory/src/semantic.ts's DeterministicLocalEmbedder
-- stood in for an undecided provider). Safe to truncate + retype: writeSemantic() had
-- zero real call sites before this phase (exhaustive grep — only test files ever called
-- it), so there is no real embedded data to lose here.
--
-- Also lands the chunking-spec metadata (§5.2): entity_refs + occurred_at, and makes
-- source_doc_id NOT NULL — "no orphan chunks" is now enforced at the DB layer, not just
-- by convention. Mirrors migration 0000's pgvector-present-or-jsonb-fallback branch
-- (dev machines without the extension keep embedding as jsonb — dimension isn't a typed
-- constraint there either way, so only the pgvector branch needs a real retype).
TRUNCATE TABLE finnor_os.embeddings;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'ALTER TABLE finnor_os.embeddings ALTER COLUMN embedding TYPE vector(1024)';
  END IF;
END $do$;
ALTER TABLE finnor_os.embeddings ALTER COLUMN source_doc_id SET NOT NULL;
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS entity_refs jsonb NOT NULL DEFAULT '[]';
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS embeddings_tenant_occurred_idx ON finnor_os.embeddings (tenant_id, occurred_at);
