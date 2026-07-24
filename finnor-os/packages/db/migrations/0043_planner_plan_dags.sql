-- B2.T1: a planner turn may now be an explicit DAG. plan_id groups the actions
-- produced by one instruction; depends_on contains sibling domain_action ids that
-- must complete before this action may be dispatched.
ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS depends_on uuid[] NOT NULL DEFAULT '{}'::uuid[];

CREATE INDEX IF NOT EXISTS domain_actions_tenant_plan_idx
  ON finnor_os.domain_actions(tenant_id, plan_id)
  WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_actions_depends_on_gin_idx
  ON finnor_os.domain_actions USING gin(depends_on);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.domain_actions TO finnor_app;
  END IF;
END $do$;
