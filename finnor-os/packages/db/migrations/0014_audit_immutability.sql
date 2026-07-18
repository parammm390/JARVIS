-- Phase 1.6: action_log (the audit trail) and business_events (the events timeline)
-- must be append-only. Revoking UPDATE/DELETE at the DB level means even a
-- compromised or buggy application code path cannot alter or erase a record — the
-- app only ever needs to INSERT a new row and SELECT existing ones.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    REVOKE UPDATE, DELETE ON finnor_os.action_log FROM finnor_app;
    REVOKE UPDATE, DELETE ON finnor_os.business_events FROM finnor_app;
    GRANT SELECT, INSERT ON finnor_os.action_log TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.business_events TO finnor_app;
  END IF;
END $do$;
