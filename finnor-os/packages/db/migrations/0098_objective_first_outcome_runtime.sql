-- Phase 3 Objective-First Operating Runtime. This extends Durable Work and the
-- existing Objective Loop; it creates no parallel controller, action, or queue.

ALTER TABLE finnor_os.works ADD COLUMN IF NOT EXISTS execution_model text;
ALTER TABLE finnor_os.works DROP CONSTRAINT IF EXISTS works_execution_model_check;
ALTER TABLE finnor_os.works ADD CONSTRAINT works_execution_model_check
  CHECK (execution_model IS NULL OR execution_model IN ('query','atomic_effect','objective'));
CREATE INDEX IF NOT EXISTS works_tenant_execution_model_status_idx
  ON finnor_os.works(tenant_id,execution_model,status);

ALTER TABLE finnor_os.works DROP CONSTRAINT IF EXISTS works_status_check;
ALTER TABLE finnor_os.works ADD CONSTRAINT works_status_check CHECK (status IN (
  'received','understanding','planning','ready','actionable','awaiting_approval',
  'executing','waiting','blocked','completed','failed','cancelled','recovery'
));
ALTER TABLE finnor_os.work_events DROP CONSTRAINT IF EXISTS work_events_from_status_check;
ALTER TABLE finnor_os.work_events ADD CONSTRAINT work_events_from_status_check CHECK (
  from_status IS NULL OR from_status IN (
    'received','understanding','planning','ready','actionable','awaiting_approval',
    'executing','waiting','blocked','completed','failed','cancelled','recovery'
  )
);
ALTER TABLE finnor_os.work_events DROP CONSTRAINT IF EXISTS work_events_to_status_check;
ALTER TABLE finnor_os.work_events ADD CONSTRAINT work_events_to_status_check CHECK (to_status IN (
  'received','understanding','planning','ready','actionable','awaiting_approval',
  'executing','waiting','blocked','completed','failed','cancelled','recovery'
));

ALTER TABLE finnor_os.work_objective_loops DROP CONSTRAINT IF EXISTS work_objective_loops_state_check;
ALTER TABLE finnor_os.work_objective_loops ADD CONSTRAINT work_objective_loops_state_check CHECK (state IN (
  'continue','awaiting_approval','waiting','blocked','completed','failed','cancelled'
));
ALTER TABLE finnor_os.work_objective_loops ADD COLUMN IF NOT EXISTS success_condition jsonb;
ALTER TABLE finnor_os.work_objective_loops ADD COLUMN IF NOT EXISTS success_verification jsonb;
ALTER TABLE finnor_os.work_objective_loops ADD COLUMN IF NOT EXISTS success_verified_at timestamptz;
ALTER TABLE finnor_os.work_objective_loops ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE finnor_os.work_objective_loops
SET success_condition=jsonb_build_object(
  'version',1,
  'statement',objective,
  'mode','all',
  'source','legacy_backfill',
  'criteria',jsonb_build_array(
    jsonb_build_object('kind','no_open_execution'),
    jsonb_build_object('kind','all_objective_effects_verified','minimumCount',0),
    jsonb_build_object(
      'kind','decision_evidence','minimumCount',1,
      'accepted',jsonb_build_array('canonical_query','business_effect','matched_event','delegation','computer_run')
    )
  )
)
WHERE success_condition IS NULL;

ALTER TABLE finnor_os.work_objective_loops ALTER COLUMN success_condition SET NOT NULL;
ALTER TABLE finnor_os.work_objective_loops DROP CONSTRAINT IF EXISTS work_objective_loops_success_condition_check;
ALTER TABLE finnor_os.work_objective_loops ADD CONSTRAINT work_objective_loops_success_condition_check CHECK (
  jsonb_typeof(success_condition)='object'
  AND success_condition->>'version'='1'
  AND success_condition->>'mode'='all'
  AND jsonb_typeof(success_condition->'criteria')='array'
  AND octet_length(success_condition::text)<=65536
  AND octet_length(coalesce(success_verification,'{}'::jsonb)::text)<=131072
);

ALTER TABLE finnor_os.work_objective_steps DROP CONSTRAINT IF EXISTS work_objective_steps_iteration_outcome_check;
ALTER TABLE finnor_os.work_objective_steps ADD CONSTRAINT work_objective_steps_iteration_outcome_check CHECK (
  iteration_outcome IS NULL OR iteration_outcome IN (
    'continue','awaiting_approval','waiting','blocked','completed','failed','cancelled'
  )
);
ALTER TABLE finnor_os.work_objective_steps ADD COLUMN IF NOT EXISTS recovery_kind text;
ALTER TABLE finnor_os.work_objective_steps ADD COLUMN IF NOT EXISTS success_verification jsonb;
ALTER TABLE finnor_os.work_objective_steps DROP CONSTRAINT IF EXISTS work_objective_steps_recovery_kind_check;
ALTER TABLE finnor_os.work_objective_steps ADD CONSTRAINT work_objective_steps_recovery_kind_check CHECK (
  recovery_kind IS NULL OR recovery_kind IN ('retry','replan','recover','compensate','escalate','block')
);
ALTER TABLE finnor_os.work_objective_steps DROP CONSTRAINT IF EXISTS work_objective_steps_success_verification_check;
ALTER TABLE finnor_os.work_objective_steps ADD CONSTRAINT work_objective_steps_success_verification_check CHECK (
  octet_length(coalesce(success_verification,'{}'::jsonb)::text)<=131072
);

COMMENT ON COLUMN finnor_os.works.execution_model IS
  'The one deterministic business instruction route: query, atomic_effect, or objective.';
COMMENT ON COLUMN finnor_os.work_objective_loops.success_condition IS
  'Persisted business success contract accepted with the objective; completion requires deterministic verification.';
COMMENT ON COLUMN finnor_os.work_objective_loops.success_verification IS
  'Latest bounded verification result for the persisted objective success contract.';
