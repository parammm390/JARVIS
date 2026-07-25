-- B6: immutable, effective-dated policy revisions and the version evaluated at draft.
ALTER TABLE finnor_os.domain_policies ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now();
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS policy_version integer;
CREATE TABLE IF NOT EXISTS finnor_os.domain_policy_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  policy_id uuid NOT NULL REFERENCES finnor_os.domain_policies(id), action_type text NOT NULL,
  version integer NOT NULL, policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  requires_confirmation boolean NOT NULL, confirmation_template text, model_provider text,
  confirmation_timeout_hours integer, effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (policy_id, version)
);
CREATE INDEX IF NOT EXISTS domain_policy_revisions_tenant_action_effective_idx ON finnor_os.domain_policy_revisions(tenant_id, action_type, effective_from);
INSERT INTO finnor_os.domain_policy_revisions (tenant_id, policy_id, action_type, version, policy, requires_confirmation, confirmation_template, model_provider, confirmation_timeout_hours, effective_from)
SELECT tenant_id, id, action_type, version, policy, requires_confirmation, confirmation_template, model_provider, confirmation_timeout_hours, effective_from FROM finnor_os.domain_policies ON CONFLICT (policy_id, version) DO NOTHING;
ALTER TABLE finnor_os.domain_policy_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.domain_policy_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.domain_policy_revisions;
CREATE POLICY tenant_isolation ON finnor_os.domain_policy_revisions USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DO $do$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN GRANT SELECT, INSERT ON finnor_os.domain_policy_revisions TO finnor_app; END IF; END $do$;
