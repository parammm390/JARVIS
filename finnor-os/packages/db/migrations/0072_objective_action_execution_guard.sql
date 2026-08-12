-- Upgrade 9 race guard: an interrupt/redirect may arrive while a model iteration is
-- still returning. The database is the last boundary before a typed action executes.
-- Once the owning objective step is finished/superseded, no late action may be bound
-- to it or transition to executing. If execution won the row race first, it is already
-- real work and the controller will observe its result rather than pretending it was
-- cancelled.

CREATE OR REPLACE FUNCTION finnor_os.assert_objective_action_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE step_tenant uuid; step_work uuid; step_completed timestamptz; loop_state text;
BEGIN
  IF NEW.objective_step_id IS NULL THEN RETURN NEW; END IF;
  SELECT s.tenant_id,s.work_id,s.completed_at,l.state
    INTO step_tenant,step_work,step_completed,loop_state
  FROM finnor_os.work_objective_steps s
  JOIN finnor_os.work_objective_loops l ON l.id=s.objective_loop_id
  WHERE s.id=NEW.objective_step_id;
  IF step_tenant IS DISTINCT FROM NEW.tenant_id OR step_work IS DISTINCT FROM NEW.work_id THEN
    RAISE EXCEPTION 'objective action crosses step, Work, or tenant boundary';
  END IF;
  IF TG_OP='INSERT' THEN
    IF step_completed IS NOT NULL OR loop_state <> 'continue' THEN
      RAISE EXCEPTION 'objective action cannot bind to a finished or inactive step';
    END IF;
  ELSIF OLD.objective_step_id IS DISTINCT FROM NEW.objective_step_id THEN
    IF step_completed IS NOT NULL OR loop_state <> 'continue' THEN
      RAISE EXCEPTION 'objective action cannot bind to a finished or inactive step';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION finnor_os.assert_objective_action_execution_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE step_completed timestamptz; step_outcome text; loop_state text;
BEGIN
  IF NEW.objective_step_id IS NULL OR NEW.status <> 'executing' OR OLD.status='executing' THEN RETURN NEW; END IF;
  SELECT s.completed_at,s.iteration_outcome,l.state INTO step_completed,step_outcome,loop_state
  FROM finnor_os.work_objective_steps s
  JOIN finnor_os.work_objective_loops l ON l.id=s.objective_loop_id
  WHERE s.id=NEW.objective_step_id;
  IF NOT (
    (step_completed IS NULL AND loop_state='continue')
    OR (step_outcome='awaiting_approval' AND loop_state='awaiting_approval')
  ) THEN
    RAISE EXCEPTION 'objective action execution refused because its step is finished or inactive';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_objective_action_execution_active() FROM PUBLIC;

DROP TRIGGER IF EXISTS domain_actions_objective_execution_active ON finnor_os.domain_actions;
CREATE TRIGGER domain_actions_objective_execution_active
BEFORE UPDATE OF status ON finnor_os.domain_actions
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_objective_action_execution_active();

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT EXECUTE ON FUNCTION finnor_os.assert_objective_action_scope(),finnor_os.assert_objective_action_execution_active() TO finnor_app;
  END IF;
END $grant$;
