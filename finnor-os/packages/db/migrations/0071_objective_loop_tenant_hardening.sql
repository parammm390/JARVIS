-- Upgrade 9 hardening: foreign keys prove existence, while these triggers also prove
-- that every controller reference belongs to the same tenant and Work. This remains
-- effective for table owners that can bypass RLS (local migration/tests included).

CREATE OR REPLACE FUNCTION finnor_os.assert_objective_loop_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE work_tenant uuid; loop_tenant uuid; loop_work uuid; related_tenant uuid;
BEGIN
  IF TG_TABLE_NAME = 'work_objective_loops' THEN
    SELECT tenant_id INTO work_tenant FROM finnor_os.works WHERE id=NEW.work_id;
    IF work_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'objective loop Work crosses tenant boundary or is missing';
    END IF;
    IF NEW.created_by IS NOT NULL THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.users WHERE id=NEW.created_by;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'objective loop creator crosses tenant boundary'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'work_objective_steps' THEN
    SELECT tenant_id,work_id INTO loop_tenant,loop_work FROM finnor_os.work_objective_loops WHERE id=NEW.objective_loop_id;
    SELECT tenant_id INTO work_tenant FROM finnor_os.works WHERE id=NEW.work_id;
    IF loop_tenant IS DISTINCT FROM NEW.tenant_id OR work_tenant IS DISTINCT FROM NEW.tenant_id OR loop_work IS DISTINCT FROM NEW.work_id THEN
      RAISE EXCEPTION 'objective step crosses loop, Work, or tenant boundary';
    END IF;
    IF NEW.domain_action_id IS NOT NULL THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'objective step action crosses tenant boundary'; END IF;
    END IF;
    IF NEW.authority_decision_id IS NOT NULL THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.authority_decisions WHERE id=NEW.authority_decision_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'objective step authority decision crosses tenant boundary'; END IF;
    END IF;
    IF NEW.query_execution_id IS NOT NULL THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.work_query_executions WHERE id=NEW.query_execution_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'objective step query execution crosses tenant boundary'; END IF;
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

CREATE OR REPLACE FUNCTION finnor_os.assert_objective_action_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE step_tenant uuid; step_work uuid;
BEGIN
  IF NEW.objective_step_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id,work_id INTO step_tenant,step_work FROM finnor_os.work_objective_steps WHERE id=NEW.objective_step_id;
  IF step_tenant IS DISTINCT FROM NEW.tenant_id OR step_work IS DISTINCT FROM NEW.work_id THEN
    RAISE EXCEPTION 'objective action crosses step, Work, or tenant boundary';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_objective_action_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS domain_actions_objective_scope ON finnor_os.domain_actions;
CREATE TRIGGER domain_actions_objective_scope
BEFORE INSERT OR UPDATE OF objective_step_id,tenant_id,work_id ON finnor_os.domain_actions
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_objective_action_scope();

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT EXECUTE ON FUNCTION finnor_os.assert_objective_loop_scope(),finnor_os.assert_objective_action_scope() TO finnor_app;
  END IF;
END $grant$;
