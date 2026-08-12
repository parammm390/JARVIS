-- Upgrade 2: JARVIS Durable Work Kernel.
--
-- Work is intentionally additive. domain_actions, workflow_runs/steps and
-- decision_receipts keep their existing execution semantics; work_id is the stable
-- causal edge that groups those proven records under the instruction received before
-- planning. Existing instruction rows are backfilled one-for-one so the previous Work
-- projection remains readable throughout rollout.

CREATE TABLE IF NOT EXISTS finnor_os.works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received','understanding','planning','ready','actionable',
    'awaiting_approval','executing','completed','failed','recovery'
  )),
  session_id text,
  initial_channel text NOT NULL CHECK (initial_channel IN ('voice','text','console')),
  initial_instruction text NOT NULL,
  created_by uuid REFERENCES finnor_os.users(id),
  active_context jsonb NOT NULL DEFAULT '{}',
  idempotency_key text,
  final_outcome jsonb,
  failure jsonb,
  recovery jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS works_tenant_status_idx ON finnor_os.works(tenant_id, status);
CREATE INDEX IF NOT EXISTS works_tenant_session_idx ON finnor_os.works(tenant_id, session_id);

CREATE TABLE IF NOT EXISTS finnor_os.work_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  instruction_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('voice','text','console')),
  session_id text,
  instruction_text text NOT NULL,
  created_by uuid REFERENCES finnor_os.users(id),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instruction_id),
  UNIQUE (work_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS work_inputs_work_created_idx ON finnor_os.work_inputs(work_id, created_at);

CREATE TABLE IF NOT EXISTS finnor_os.work_planner_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  work_input_id uuid REFERENCES finnor_os.work_inputs(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  attempt_key text NOT NULL,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','succeeded','failed','timed_out')),
  planner_result jsonb,
  failure jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (work_id, attempt),
  UNIQUE (work_id, attempt_key)
);
CREATE INDEX IF NOT EXISTS work_planner_attempts_tenant_work_idx ON finnor_os.work_planner_attempts(tenant_id, work_id);

CREATE TABLE IF NOT EXISTS finnor_os.work_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  seq integer NOT NULL,
  event_type text NOT NULL,
  from_status text CHECK (from_status IS NULL OR from_status IN (
    'received','understanding','planning','ready','actionable',
    'awaiting_approval','executing','completed','failed','recovery'
  )),
  to_status text NOT NULL CHECK (to_status IN (
    'received','understanding','planning','ready','actionable',
    'awaiting_approval','executing','completed','failed','recovery'
  )),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, seq)
);
CREATE INDEX IF NOT EXISTS work_events_tenant_work_idx ON finnor_os.work_events(tenant_id, work_id);

ALTER TABLE finnor_os.instruction_sessions ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS planner_attempt_id uuid REFERENCES finnor_os.work_planner_attempts(id);
ALTER TABLE finnor_os.workflow_runs ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.plan_repairs ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);

CREATE INDEX IF NOT EXISTS instruction_sessions_work_idx ON finnor_os.instruction_sessions(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_actions_work_idx ON finnor_os.domain_actions(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_actions_planner_attempt_idx ON finnor_os.domain_actions(planner_attempt_id) WHERE planner_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS workflow_runs_work_idx ON finnor_os.workflow_runs(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS decision_receipts_work_idx ON finnor_os.decision_receipts(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plan_repairs_work_idx ON finnor_os.plan_repairs(work_id) WHERE work_id IS NOT NULL;

-- Backfill each historical instruction as its own Work. Work ids intentionally equal
-- the old instruction ids, preserving stable client URLs and projection identity.
INSERT INTO finnor_os.works (
  id, tenant_id, status, session_id, initial_channel, initial_instruction,
  created_by, active_context, final_outcome, failure, created_at, updated_at
)
SELECT
  s.id,
  s.tenant_id,
  CASE
    WHEN last_event.phase = 'failed' THEN 'failed'
    WHEN last_event.phase IN ('completed','cancelled','verified') THEN 'completed'
    WHEN last_event.phase = 'action_gated' THEN 'awaiting_approval'
    WHEN last_event.phase IN ('executing','step_progress','verifying') THEN 'executing'
    WHEN last_event.phase IN ('plan_ready','action_created','clarification_required','dispatched') THEN 'actionable'
    WHEN last_event.phase = 'planning' THEN 'planning'
    WHEN last_event.phase = 'context_retrieved' THEN 'understanding'
    ELSE 'received'
  END,
  s.session_id,
  CASE WHEN s.source = 'voice' THEN 'voice' ELSE 'text' END,
  s.instruction_text,
  s.user_id,
  '{}'::jsonb,
  CASE WHEN last_event.phase IN ('completed','cancelled','verified') THEN last_event.payload ELSE NULL END,
  CASE WHEN last_event.phase = 'failed' THEN last_event.payload ELSE NULL END,
  s.created_at,
  s.updated_at
FROM finnor_os.instruction_sessions s
LEFT JOIN LATERAL (
  SELECT e.phase, e.payload
  FROM finnor_os.instruction_events e
  WHERE e.instruction_id = s.id
  ORDER BY e.seq DESC
  LIMIT 1
) last_event ON true
ON CONFLICT (id) DO NOTHING;

UPDATE finnor_os.instruction_sessions SET work_id = id WHERE work_id IS NULL;

INSERT INTO finnor_os.work_inputs (
  id, tenant_id, work_id, instruction_id, channel, session_id,
  instruction_text, created_by, created_at
)
SELECT
  s.id, s.tenant_id, s.work_id, s.id,
  CASE WHEN s.source = 'voice' THEN 'voice' ELSE 'text' END,
  s.session_id, s.instruction_text, s.user_id, s.created_at
FROM finnor_os.instruction_sessions s
WHERE s.work_id IS NOT NULL
ON CONFLICT (tenant_id, instruction_id) DO NOTHING;

UPDATE finnor_os.domain_actions a
SET work_id = s.work_id
FROM finnor_os.instruction_sessions s
WHERE a.instruction_id = s.id AND a.work_id IS NULL;

UPDATE finnor_os.workflow_runs r
SET work_id = linked.work_id
FROM (
  SELECT ws.workflow_run_id, min(a.work_id::text)::uuid AS work_id
  FROM finnor_os.workflow_steps ws
  JOIN finnor_os.domain_actions a ON a.id = ws.domain_action_id
  WHERE a.work_id IS NOT NULL
  GROUP BY ws.workflow_run_id
  HAVING count(DISTINCT a.work_id) = 1
) linked
WHERE r.id = linked.workflow_run_id AND r.work_id IS NULL;

UPDATE finnor_os.decision_receipts receipt
SET work_id = r.work_id
FROM finnor_os.workflow_runs r
WHERE receipt.workflow_run_id = r.id
  AND r.work_id IS NOT NULL
  AND receipt.work_id IS NULL;

UPDATE finnor_os.decision_receipts receipt
SET work_id = a.work_id
FROM finnor_os.domain_actions a
WHERE receipt.domain_action_id = a.id
  AND receipt.work_id IS NULL;

UPDATE finnor_os.plan_repairs repair
SET work_id = a.work_id
FROM finnor_os.domain_actions a
WHERE repair.failed_domain_action_id = a.id
  AND repair.work_id IS NULL;

-- Seed one immutable received event for historical works that have no Work ledger.
INSERT INTO finnor_os.work_events (tenant_id, work_id, seq, event_type, from_status, to_status, payload, created_at)
SELECT w.tenant_id, w.id, 1, 'backfilled', NULL, w.status, '{"source":"instruction_sessions"}'::jsonb, w.created_at
FROM finnor_os.works w
WHERE NOT EXISTS (SELECT 1 FROM finnor_os.work_events e WHERE e.work_id = w.id);

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['works','work_inputs','work_planner_attempts','work_events'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.works TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.work_inputs TO finnor_app;
    GRANT SELECT, INSERT, UPDATE ON finnor_os.work_planner_attempts TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.work_events TO finnor_app;
  END IF;
END $rls$;
