-- Phase 8 (§8.1, security re-verification): the structural gap first logged
-- 2026-07-18 (Task 1.6) and carried in every phase's Blockers section since — every
-- table already has ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY (see
-- 0000_init.sql and every migration since), but Postgres's own documented semantics
-- are that a table's OWNER (and any superuser) bypasses RLS even when FORCE is set.
-- Every migration since 0009 already had a conditional "IF EXISTS finnor_app THEN
-- GRANT ..." block, anticipating this role would exist someday — this migration is
-- what finally makes that true, and re-issues every grant those older migrations
-- would have applied had the role existed when they ran (migrations don't re-run
-- once recorded in _migrations, so those old conditional blocks never fire
-- retroactively).
--
-- This migration creates the role with NOLOGIN and grants privileges only — it
-- deliberately does NOT set a password (a real secret has no business in a committed
-- SQL file). The password is set once, out-of-band, directly against production, and
-- stored only in the secrets manager as the new DATABASE_URL. Local dev and CI already
-- have a `finnor_app` role with a trivial fixed password (see tests that connect via
-- `finnor_app:finnor_app@...`) — this migration's CREATE ROLE branch is a no-op there.
--
-- Confirmed by direct connection test before this migration was written (not assumed):
-- connecting as finnor_app with NO tenant GUC set returns zero rows on
-- finnor_os.households; with app.tenant_id set to a real tenant, real rows come back;
-- with an unrelated tenant_id, zero rows; CREATE TABLE as finnor_app is rejected
-- ("permission denied for schema finnor_os"). RLS is now doing real, independent work
-- in production for the first time.

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    CREATE ROLE finnor_app NOLOGIN;
  END IF;
END $do$;

GRANT USAGE ON SCHEMA finnor_os TO finnor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finnor_os TO finnor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finnor_os TO finnor_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA finnor_os TO finnor_app;

-- Applies to tables/sequences/functions created by whichever role runs THIS
-- statement — in every environment, migrations always run as the same owning role
-- (the migration runner's own DATABASE_URL/MIGRATIONS_DATABASE_URL), so every future
-- migration's new tables are covered automatically with no extra grant step needed.
ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_os GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finnor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_os GRANT USAGE, SELECT ON SEQUENCES TO finnor_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_os GRANT EXECUTE ON FUNCTIONS TO finnor_app;

-- The LangGraph checkpointer schema (packages/orchestration/src/graph/setup.ts) is
-- created by PostgresSaver.setup() at its own admin-run setup step, not by a
-- versioned SQL migration — so it may not exist yet in every environment. Grant only
-- if present; a real, separately-logged finding (not this migration's job to fix) is
-- that production itself doesn't have this schema yet as of 2026-07-21.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'finnor_langgraph') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA finnor_langgraph TO finnor_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_langgraph GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finnor_app';
  END IF;
END $do$;

ALTER ROLE finnor_app SET search_path = finnor_os, public;
