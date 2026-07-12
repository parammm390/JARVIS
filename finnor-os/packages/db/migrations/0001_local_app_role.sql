-- Local/CI only: a non-superuser role so RLS is actually exercised in tests
-- (the docker-compose superuser bypasses RLS by definition). Guarded to the local
-- database name so this never creates a weak-password role on a hosted instance.
DO $do$
BEGIN
  IF current_database() = 'finnor' THEN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      CREATE ROLE finnor_app LOGIN PASSWORD 'finnor_app' NOSUPERUSER NOBYPASSRLS;
    END IF;
    GRANT USAGE ON SCHEMA finnor_os TO finnor_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA finnor_os TO finnor_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA finnor_os GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finnor_app;
    ALTER ROLE finnor_app SET search_path = finnor_os, public;
  END IF;
END $do$;
