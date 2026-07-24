-- A5.T2: after the production cutover, finnor_app correctly has no tenant context
-- before authentication finishes, so a direct SELECT on users is RLS-empty. This
-- narrowly-scoped SECURITY DEFINER function is the one bootstrap bridge: application
-- code supplies only the email already verified by Supabase and receives only that
-- identity's own user/tenant/role mapping. It does not expose a general tenant query.

CREATE OR REPLACE FUNCTION finnor_os.resolve_authenticated_identity(p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, user_role text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, finnor_os
AS $$
  SELECT u.id, u.tenant_id, u.role
  FROM finnor_os.users AS u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION finnor_os.resolve_authenticated_identity(text) FROM PUBLIC;
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT EXECUTE ON FUNCTION finnor_os.resolve_authenticated_identity(text) TO finnor_app;
  END IF;
END $do$;
