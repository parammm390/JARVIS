-- D6.T1: per-user cockpit preferences. Tenant isolation alone is not sufficient for
-- this table: its RLS policy additionally requires the application-set user GUC, so
-- a tenant peer cannot read or alter another person's preferences through a future
-- route mistake. API access uses withTenant(..., userId), which sets that GUC locally.
CREATE TABLE IF NOT EXISTS finnor_os.user_prefs (
  user_id uuid PRIMARY KEY REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  homepage text CHECK (homepage IS NULL OR homepage IN ('bridge', 'map', 'my-day')),
  density text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  pinned_panels jsonb NOT NULL DEFAULT '[]',
  accent text,
  sound_enabled boolean NOT NULL DEFAULT false,
  notification_preferences jsonb NOT NULL DEFAULT '{}',
  quiet_hours_start text,
  quiet_hours_end text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (quiet_hours_start IS NULL AND quiet_hours_end IS NULL)
    OR (quiet_hours_start ~ '^[0-2][0-9]:[0-5][0-9]$' AND quiet_hours_end ~ '^[0-2][0-9]:[0-5][0-9]$')
  ),
  CHECK (quiet_hours_start IS NULL OR quiet_hours_start < '24:00'),
  CHECK (quiet_hours_end IS NULL OR quiet_hours_end < '24:00')
);
CREATE INDEX IF NOT EXISTS user_prefs_tenant_idx ON finnor_os.user_prefs(tenant_id);

ALTER TABLE finnor_os.user_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.user_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_prefs_self_only ON finnor_os.user_prefs;
CREATE POLICY user_prefs_self_only ON finnor_os.user_prefs
  USING (
    tenant_id = finnor_os.request_tenant_id()
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    tenant_id = finnor_os.request_tenant_id()
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.user_prefs TO finnor_app;
  END IF;
END $do$;
