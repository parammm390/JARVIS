-- Phase 1 client identity + convergent provisioning.
-- Existing tenants receive a stable, explicit legacy key. Operators can provision
-- them with that key immediately and deliberately rename it later if required;
-- tenant names are never guessed to be identities.

ALTER TABLE finnor_os.tenants ADD COLUMN IF NOT EXISTS client_key text;
UPDATE finnor_os.tenants
SET client_key = 'legacy-' || id::text
WHERE client_key IS NULL;
ALTER TABLE finnor_os.tenants ALTER COLUMN client_key SET NOT NULL;
ALTER TABLE finnor_os.tenants ALTER COLUMN client_key
  SET DEFAULT ('legacy-' || gen_random_uuid()::text);
ALTER TABLE finnor_os.tenants
  DROP CONSTRAINT IF EXISTS tenants_client_key_format_check;
ALTER TABLE finnor_os.tenants
  ADD CONSTRAINT tenants_client_key_format_check
  CHECK (client_key = lower(client_key) AND client_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$');
CREATE UNIQUE INDEX IF NOT EXISTS tenants_client_key_unique_idx
  ON finnor_os.tenants (client_key);

-- Supabase email identity is case-insensitive. Normalize the application directory
-- to the same boundary and refuse to guess if legacy case variants collide.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finnor_os.users
    GROUP BY lower(btrim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot normalize users.email: case-insensitive duplicate identities exist';
  END IF;
END $guard$;
UPDATE finnor_os.users SET email = lower(btrim(email))
WHERE email IS DISTINCT FROM lower(btrim(email));
ALTER TABLE finnor_os.users DROP CONSTRAINT IF EXISTS users_email_normalized_check;
ALTER TABLE finnor_os.users ADD CONSTRAINT users_email_normalized_check
  CHECK (email = lower(email) AND email = btrim(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_unique_idx
  ON finnor_os.users (lower(email));

-- A policy action is one current configuration row per tenant. Historical states
-- remain in immutable domain_policy_revisions. Never silently merge ambiguous legacy
-- current rows because doing so could corrupt policy/action provenance.
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM finnor_os.domain_policies
    GROUP BY tenant_id, action_type HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce policy identity: duplicate tenant/action policy rows exist';
  END IF;
END $guard$;
CREATE UNIQUE INDEX IF NOT EXISTS domain_policies_tenant_action_unique_idx
  ON finnor_os.domain_policies (tenant_id, action_type);

CREATE TABLE IF NOT EXISTS finnor_os.tenant_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  location_key text NOT NULL,
  name text NOT NULL,
  address text,
  timezone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_locations_key_format_check
    CHECK (location_key = lower(location_key) AND location_key ~ '^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$'),
  CONSTRAINT tenant_locations_tenant_key_unique UNIQUE (tenant_id, location_key)
);
CREATE INDEX IF NOT EXISTS tenant_locations_tenant_idx
  ON finnor_os.tenant_locations (tenant_id);

ALTER TABLE finnor_os.tenant_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_locations;
CREATE POLICY tenant_isolation ON finnor_os.tenant_locations
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.tenant_locations TO finnor_app;
  END IF;
END $grants$;
