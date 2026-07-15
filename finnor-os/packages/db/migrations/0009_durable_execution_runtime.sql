-- Durable execution runtime (Phase 2, docs/jarvis-90-execution-blueprint.md §3).
-- Extends the existing atomic UPDATE...WHERE status=<expected> concurrency pattern
-- (domain_actions) and the existing Postgres job queue (jobs table) rather than
-- introducing a second queue system. All new tables use direct tenant_id RLS, matching
-- migrations/0008's convention.

CREATE TABLE IF NOT EXISTS finnor_os.commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  command_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  idempotency_key text,
  requested_by text,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','running','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  command_id uuid NOT NULL REFERENCES finnor_os.commands(id),
  workflow_type text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','compensating','compensated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  workflow_run_id uuid NOT NULL REFERENCES finnor_os.workflow_runs(id),
  step_type text NOT NULL,
  sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','completed','failed','compensating','compensated')),
  idempotency_key text NOT NULL,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}',
  terminal_reason text,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, sequence)
);
CREATE INDEX IF NOT EXISTS workflow_steps_leased_idx ON finnor_os.workflow_steps (lease_expires_at) WHERE status = 'leased';

CREATE TABLE IF NOT EXISTS finnor_os.integration_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  workflow_step_id uuid NOT NULL REFERENCES finnor_os.workflow_steps(id),
  operation_key text NOT NULL,
  capability text NOT NULL,
  request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed','unknown')),
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_step_id, operation_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  workflow_step_id uuid REFERENCES finnor_os.workflow_steps(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivering','delivered','unknown','failed')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx ON finnor_os.outbox_events (tenant_id, status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS finnor_os.inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  provider text NOT NULL,
  event_id text NOT NULL,
  payload_hash text NOT NULL,
  matched_step_id uuid REFERENCES finnor_os.workflow_steps(id),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','matched','unmatched','duplicate')),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.reconciliation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  case_type text NOT NULL CHECK (case_type IN ('unknown_delivery','unmatched_inbox_event')),
  related_outbox_event_id uuid REFERENCES finnor_os.outbox_events(id),
  related_inbox_event_id uuid REFERENCES finnor_os.inbox_events(id),
  related_step_id uuid REFERENCES finnor_os.workflow_steps(id),
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS reconciliation_cases_open_idx ON finnor_os.reconciliation_cases (tenant_id, status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS finnor_os.compensation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  workflow_step_id uuid NOT NULL REFERENCES finnor_os.workflow_steps(id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed')),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commands','workflow_runs','workflow_steps','integration_operations','outbox_events',
    'inbox_events','reconciliation_cases','compensation_cases'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I;
       CREATE POLICY tenant_isolation ON finnor_os.%I
         USING (tenant_id = finnor_os.request_tenant_id())
         WITH CHECK (tenant_id = finnor_os.request_tenant_id())', t, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.%I TO finnor_app', t);
    END IF;
  END LOOP;
END $do$;
