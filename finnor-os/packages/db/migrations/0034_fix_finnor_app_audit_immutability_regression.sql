-- Fixes a real regression introduced by 0032 in this same session: that migration's
-- blanket "GRANT ... ON ALL TABLES IN SCHEMA finnor_os TO finnor_app" re-granted
-- UPDATE/DELETE on finnor_os.action_log and finnor_os.business_events — undoing
-- migration 0014's deliberate REVOKE, which exists specifically so a compromised or
-- buggy application code path cannot alter or erase either audit table even at the
-- database-permission layer (defense in depth alongside 0015's trigger, which fires
-- regardless of role and was NOT weakened by this bug — but 0014's own stated intent,
-- and this repo's own audit-immutability.test.ts, expect BOTH layers to independently
-- hold). Caught by that exact test (tests/integration/audit-immutability.test.ts)
-- failing immediately after 0032/0033 were applied locally — not shipped unnoticed.
--
-- Every other finnor_os table keeps the full grant from 0032; only these two,
-- deliberately append-only tables are narrowed back down, matching 0014 exactly.

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    REVOKE UPDATE, DELETE ON finnor_os.action_log FROM finnor_app;
    REVOKE UPDATE, DELETE ON finnor_os.business_events FROM finnor_app;
  END IF;
END $do$;
