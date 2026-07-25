-- B5: durable LLM accounting and tenant-scoped daily token caps.
CREATE TABLE IF NOT EXISTS finnor_os.llm_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  trace_id text,
  purpose text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cost_usd real,
  status text NOT NULL CHECK (status IN ('completed', 'deferred', 'failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS llm_calls_tenant_created_idx ON finnor_os.llm_calls(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS llm_calls_action_idx ON finnor_os.llm_calls(domain_action_id);

CREATE TABLE IF NOT EXISTS finnor_os.tenant_llm_budgets (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  daily_token_budget integer NOT NULL CHECK (daily_token_budget >= 0),
  soft_limit_percent integer NOT NULL DEFAULT 80 CHECK (soft_limit_percent BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS llm_cost_usd real;
ALTER TABLE finnor_os.readiness_log ADD COLUMN IF NOT EXISTS llm_spend_usd real;
ALTER TABLE finnor_os.readiness_log ADD COLUMN IF NOT EXISTS llm_calls integer;

ALTER TABLE finnor_os.llm_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.llm_calls FORCE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_llm_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_llm_budgets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_calls_tenant_isolation ON finnor_os.llm_calls;
CREATE POLICY llm_calls_tenant_isolation ON finnor_os.llm_calls
  USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DROP POLICY IF EXISTS tenant_llm_budgets_tenant_isolation ON finnor_os.tenant_llm_budgets;
CREATE POLICY tenant_llm_budgets_tenant_isolation ON finnor_os.tenant_llm_budgets
  USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id());
DO $do$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.llm_calls, finnor_os.tenant_llm_budgets TO finnor_app;
  END IF;
END $do$;
