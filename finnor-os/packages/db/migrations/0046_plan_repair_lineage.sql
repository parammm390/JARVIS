-- B2.T6: a terminal workflow-step failure may produce one lineaged repair plan.
ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS repaired_from_plan_id uuid;

CREATE INDEX IF NOT EXISTS domain_actions_tenant_repaired_from_plan_idx
  ON finnor_os.domain_actions(tenant_id, repaired_from_plan_id)
  WHERE repaired_from_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.plan_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  failed_domain_action_id uuid NOT NULL REFERENCES finnor_os.domain_actions(id),
  source_plan_id uuid NOT NULL,
  repair_plan_id uuid,
  terminal_receipt jsonb NOT NULL,
  status text NOT NULL DEFAULT 'planning',
  created_at timestamptz NOT NULL DEFAULT now(),
  proposed_at timestamptz,
  UNIQUE(failed_domain_action_id)
);

CREATE INDEX IF NOT EXISTS plan_repairs_tenant_source_plan_idx
  ON finnor_os.plan_repairs(tenant_id, source_plan_id);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.plan_repairs TO finnor_app;
  END IF;
END $do$;
