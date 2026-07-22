-- A1 critical finding follow-through (2026-07-22): migration 0032's finnor_langgraph
-- grant block was a no-op in every environment because the schema didn't exist yet at
-- that point (this is the same gap that caused the "relation does not exist" crash,
-- fixed for real via POST /api/admin/migrate now also running PostgresSaver.setup()).
-- Re-issues exactly the grants 0032 would have applied had the schema existed then.
-- Safe/idempotent regardless of whether finnor_langgraph or finnor_app exist yet in a
-- given environment (both checked, matching 0032's own conditional style).

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'finnor_langgraph')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_langgraph GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finnor_app';
  END IF;
END $do$;
