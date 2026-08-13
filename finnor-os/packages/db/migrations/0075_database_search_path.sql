-- Upgrade 10 clean-database proof exposed an implicit environment dependency: raw
-- queue/health queries use the canonical unqualified table names while long-lived
-- developer and production databases happened to have a role-level search_path.
-- A newly created database did not, so a fully successful migration could still
-- start an application process that could not find finnor_os.jobs.
--
-- Scope the default to this database rather than changing the migration owner's
-- cluster-wide role. Restricted runtime roles retain their own explicit default,
-- and tenant transactions still set the same path locally before every query.

DO $database_search_path$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path = finnor_os, public',
    current_database()
  );
END $database_search_path$;
