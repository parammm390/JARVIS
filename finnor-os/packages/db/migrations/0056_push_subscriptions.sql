-- B8.T1: a subscription belongs to one authenticated user and tenant. Endpoints are
-- opaque provider URLs, so only the owner may read/write them through the user GUC.
CREATE TABLE IF NOT EXISTS finnor_os.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  user_id uuid NOT NULL REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_tenant_user_idx ON finnor_os.push_subscriptions(tenant_id, user_id);

ALTER TABLE finnor_os.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.push_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS push_subscriptions_self_only ON finnor_os.push_subscriptions;
CREATE POLICY push_subscriptions_self_only ON finnor_os.push_subscriptions
  USING (tenant_id = finnor_os.request_tenant_id() AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (tenant_id = finnor_os.request_tenant_id() AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.push_subscriptions TO finnor_app;
  END IF;
END $do$;
