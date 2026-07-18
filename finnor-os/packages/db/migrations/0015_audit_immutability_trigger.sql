-- Phase 1.6 (real fix): migration 0014's REVOKE only affects the finnor_app role,
-- which exists in local/CI (migration 0001) but NOT in production — production
-- connects as the schema owner, which always bypasses GRANT/REVOKE regardless of
-- role. A trigger fires unconditionally for every connecting role, including the
-- owner, so it is the guarantee that actually holds in production.

-- Test-only escape hatch: a handful of existing integration tests need to reset their
-- own fixture rows between runs (and one deliberately backdates a timestamp to
-- simulate elapsed time). No application code path ever sets this — it is a
-- transaction-local GUC, never derived from request input, so production stays fully
-- protected. Defaults closed: current_setting(..., true) returns NULL when unset,
-- and NULL = 'true' is not true, so the exception fires unless a caller opts in.
CREATE OR REPLACE FUNCTION finnor_os.reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_audit_mutation', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'finnor_os.% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS action_log_append_only ON finnor_os.action_log;
CREATE TRIGGER action_log_append_only
  BEFORE UPDATE OR DELETE ON finnor_os.action_log
  FOR EACH ROW EXECUTE FUNCTION finnor_os.reject_audit_mutation();

DROP TRIGGER IF EXISTS business_events_append_only ON finnor_os.business_events;
CREATE TRIGGER business_events_append_only
  BEFORE UPDATE OR DELETE ON finnor_os.business_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.reject_audit_mutation();
