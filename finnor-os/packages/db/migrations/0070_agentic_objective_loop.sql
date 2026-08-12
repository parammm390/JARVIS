-- Upgrade 9: governed agentic objective loop inside Durable Work.
--
-- The existing Work/action/query/workflow/operation/receipt tables remain the
-- business sources of truth. These three tables persist only the controller state,
-- one bounded decision per iteration, and the model/provider attempts needed to
-- recover that decision after a timeout or process restart.

ALTER TABLE finnor_os.works DROP CONSTRAINT IF EXISTS works_status_check;
ALTER TABLE finnor_os.works ADD CONSTRAINT works_status_check CHECK (status IN (
  'received','understanding','planning','ready','actionable','awaiting_approval',
  'executing','waiting','blocked','completed','failed','recovery'
));
ALTER TABLE finnor_os.work_events DROP CONSTRAINT IF EXISTS work_events_from_status_check;
ALTER TABLE finnor_os.work_events ADD CONSTRAINT work_events_from_status_check CHECK (
  from_status IS NULL OR from_status IN (
    'received','understanding','planning','ready','actionable','awaiting_approval',
    'executing','waiting','blocked','completed','failed','recovery'
  )
);
ALTER TABLE finnor_os.work_events DROP CONSTRAINT IF EXISTS work_events_to_status_check;
ALTER TABLE finnor_os.work_events ADD CONSTRAINT work_events_to_status_check CHECK (to_status IN (
  'received','understanding','planning','ready','actionable','awaiting_approval',
  'executing','waiting','blocked','completed','failed','recovery'
));

CREATE TABLE IF NOT EXISTS finnor_os.work_objective_loops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL UNIQUE REFERENCES finnor_os.works(id),
  objective text NOT NULL CHECK (length(objective) BETWEEN 1 AND 10000),
  state text NOT NULL DEFAULT 'continue' CHECK (state IN (
    'continue','awaiting_approval','waiting','blocked','completed','failed'
  )),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count >= 0),
  action_count integer NOT NULL DEFAULT 0 CHECK (action_count >= 0),
  query_count integer NOT NULL DEFAULT 0 CHECK (query_count >= 0),
  planner_failure_count integer NOT NULL DEFAULT 0 CHECK (planner_failure_count >= 0),
  consecutive_no_progress integer NOT NULL DEFAULT 0 CHECK (consecutive_no_progress >= 0),
  max_steps integer NOT NULL DEFAULT 12 CHECK (max_steps BETWEEN 1 AND 50),
  max_actions integer NOT NULL DEFAULT 5 CHECK (max_actions BETWEEN 0 AND 25),
  max_queries integer NOT NULL DEFAULT 12 CHECK (max_queries BETWEEN 1 AND 50),
  max_planner_failures integer NOT NULL DEFAULT 3 CHECK (max_planner_failures BETWEEN 1 AND 10),
  max_consecutive_no_progress integer NOT NULL DEFAULT 3 CHECK (max_consecutive_no_progress BETWEEN 1 AND 10),
  deadline_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  next_run_at timestamptz,
  reason text,
  next_step text,
  last_observation jsonb,
  created_by uuid REFERENCES finnor_os.users(id),
  initial_channel text NOT NULL CHECK (initial_channel IN ('voice','text','console')),
  lease_owner text,
  lease_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (octet_length(coalesce(last_observation, '{}'::jsonb)::text) <= 65536)
);
CREATE INDEX IF NOT EXISTS work_objective_loops_tenant_state_next_idx
  ON finnor_os.work_objective_loops(tenant_id, state, next_run_at);

CREATE TABLE IF NOT EXISTS finnor_os.work_objective_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  objective_loop_id uuid NOT NULL REFERENCES finnor_os.work_objective_loops(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  step_number integer NOT NULL CHECK (step_number > 0),
  idempotency_key text NOT NULL,
  phase text NOT NULL DEFAULT 'inspecting' CHECK (phase IN (
    'inspecting','deciding','acting','observing','finished'
  )),
  inspection jsonb,
  inspection_hash text,
  decision_kind text CHECK (decision_kind IS NULL OR decision_kind IN (
    'query','action','wait','complete','block','fail'
  )),
  decision jsonb,
  decision_reason text,
  authority_decision_id uuid REFERENCES finnor_os.authority_decisions(id),
  query_execution_id uuid REFERENCES finnor_os.work_query_executions(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  observation jsonb,
  progress_made boolean,
  iteration_outcome text CHECK (iteration_outcome IS NULL OR iteration_outcome IN (
    'continue','awaiting_approval','waiting','blocked','completed','failed'
  )),
  scheduled_for timestamptz,
  failure jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(objective_loop_id, step_number),
  UNIQUE(objective_loop_id, idempotency_key),
  UNIQUE(domain_action_id),
  UNIQUE(query_execution_id),
  CHECK (octet_length(coalesce(inspection, '{}'::jsonb)::text) <= 131072),
  CHECK (octet_length(coalesce(decision, '{}'::jsonb)::text) <= 32768),
  CHECK (octet_length(coalesce(observation, '{}'::jsonb)::text) <= 65536),
  CHECK (octet_length(coalesce(failure, '{}'::jsonb)::text) <= 16384)
);
CREATE INDEX IF NOT EXISTS work_objective_steps_tenant_loop_idx
  ON finnor_os.work_objective_steps(tenant_id, objective_loop_id, step_number);
CREATE INDEX IF NOT EXISTS work_objective_steps_tenant_outcome_idx
  ON finnor_os.work_objective_steps(tenant_id, iteration_outcome, completed_at);

CREATE TABLE IF NOT EXISTS finnor_os.work_objective_planner_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  objective_loop_id uuid NOT NULL REFERENCES finnor_os.work_objective_loops(id),
  objective_step_id uuid NOT NULL REFERENCES finnor_os.work_objective_steps(id),
  attempt integer NOT NULL CHECK (attempt > 0),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN (
    'planning','succeeded','failed','timed_out'
  )),
  provider text,
  inspection_hash text NOT NULL,
  decision jsonb,
  failure jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(objective_step_id, attempt),
  CHECK (octet_length(coalesce(decision, '{}'::jsonb)::text) <= 32768),
  CHECK (octet_length(coalesce(failure, '{}'::jsonb)::text) <= 16384)
);
CREATE INDEX IF NOT EXISTS work_objective_attempts_tenant_loop_idx
  ON finnor_os.work_objective_planner_attempts(tenant_id, objective_loop_id, started_at);

ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS objective_step_id uuid REFERENCES finnor_os.work_objective_steps(id);
CREATE UNIQUE INDEX IF NOT EXISTS domain_actions_objective_step_idx
  ON finnor_os.domain_actions(objective_step_id) WHERE objective_step_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finnor_os.assert_objective_loop_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE work_tenant uuid; loop_tenant uuid; loop_work uuid; action_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'work_objective_loops' THEN
    SELECT tenant_id INTO work_tenant FROM finnor_os.works WHERE id=NEW.work_id;
    IF work_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'objective loop Work crosses tenant boundary or is missing';
    END IF;
  ELSIF TG_TABLE_NAME = 'work_objective_steps' THEN
    SELECT tenant_id,work_id INTO loop_tenant,loop_work FROM finnor_os.work_objective_loops WHERE id=NEW.objective_loop_id;
    SELECT tenant_id INTO work_tenant FROM finnor_os.works WHERE id=NEW.work_id;
    IF loop_tenant IS DISTINCT FROM NEW.tenant_id OR work_tenant IS DISTINCT FROM NEW.tenant_id OR loop_work IS DISTINCT FROM NEW.work_id THEN
      RAISE EXCEPTION 'objective step crosses loop, Work, or tenant boundary';
    END IF;
    IF NEW.domain_action_id IS NOT NULL THEN
      SELECT tenant_id INTO action_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id;
      IF action_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'objective step action crosses tenant boundary'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'work_objective_planner_attempts' THEN
    SELECT tenant_id INTO loop_tenant FROM finnor_os.work_objective_loops WHERE id=NEW.objective_loop_id;
    SELECT tenant_id INTO work_tenant FROM finnor_os.work_objective_steps WHERE id=NEW.objective_step_id AND objective_loop_id=NEW.objective_loop_id;
    IF loop_tenant IS DISTINCT FROM NEW.tenant_id OR work_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'objective planner attempt crosses step, loop, or tenant boundary';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_objective_loop_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS work_objective_loops_scope ON finnor_os.work_objective_loops;
CREATE TRIGGER work_objective_loops_scope BEFORE INSERT OR UPDATE ON finnor_os.work_objective_loops
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_objective_loop_scope();
DROP TRIGGER IF EXISTS work_objective_steps_scope ON finnor_os.work_objective_steps;
CREATE TRIGGER work_objective_steps_scope BEFORE INSERT OR UPDATE ON finnor_os.work_objective_steps
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_objective_loop_scope();
DROP TRIGGER IF EXISTS work_objective_attempts_scope ON finnor_os.work_objective_planner_attempts;
CREATE TRIGGER work_objective_attempts_scope BEFORE INSERT OR UPDATE ON finnor_os.work_objective_planner_attempts
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_objective_loop_scope();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['work_objective_loops','work_objective_steps','work_objective_planner_attempts'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.work_objective_loops,finnor_os.work_objective_steps,finnor_os.work_objective_planner_attempts TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_objective_loop_scope() TO finnor_app;
    REVOKE DELETE ON finnor_os.work_objective_loops,finnor_os.work_objective_steps,finnor_os.work_objective_planner_attempts FROM finnor_app;
  END IF;
END $rls$;

DROP TRIGGER IF EXISTS work_objective_loops_notify ON finnor_os.work_objective_loops;
CREATE TRIGGER work_objective_loops_notify
  AFTER INSERT OR UPDATE OF state,step_count,next_run_at ON finnor_os.work_objective_loops
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('work_objective');

