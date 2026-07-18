-- Phase 2 (§2.4): finish the Phase-16(e) correlationId thread into the durable
-- runtime. Denormalized onto both commands (the origin) and workflow_steps (so a
-- step's receipt can read it directly, no join) — same convention this schema already
-- uses for tenant_id everywhere.
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS correlation_id text;
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS correlation_id text;
