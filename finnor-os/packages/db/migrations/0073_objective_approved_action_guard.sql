-- Upgrade 9 corrective hardening for databases that already applied 0072: a gated
-- action legitimately executes after its objective iteration has finished in
-- `awaiting_approval`. Keep that one explicit transition while still rejecting a
-- late execution after interrupt/redirect.

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
