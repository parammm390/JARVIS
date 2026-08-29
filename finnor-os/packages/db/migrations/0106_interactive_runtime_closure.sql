-- Interactive Runtime Closure: every accepted interactive Work input owns one
-- absolute deadline. A durable high-priority reconciliation job uses this value
-- to close Work visibly if an API process disappears during understanding/planning.
ALTER TABLE finnor_os.work_inputs
  ADD COLUMN IF NOT EXISTS intake_deadline_at timestamptz;

CREATE INDEX IF NOT EXISTS work_inputs_tenant_intake_deadline_idx
  ON finnor_os.work_inputs (tenant_id,intake_deadline_at)
  WHERE intake_deadline_at IS NOT NULL;

COMMENT ON COLUMN finnor_os.work_inputs.intake_deadline_at IS
  'Single absolute interactive-intake deadline shared by provider/planner/repair and durable lifecycle reconciliation.';
