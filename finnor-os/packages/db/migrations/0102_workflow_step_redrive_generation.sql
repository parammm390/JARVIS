-- A terminal jobs row must not permanently consume a workflow step's one durable
-- idempotency key. Each explicit redrive advances this generation and receives a new
-- immutable queue key; workers fence stale deliveries against the current value.
ALTER TABLE finnor_os.workflow_steps
  ADD COLUMN IF NOT EXISTS dispatch_generation integer NOT NULL DEFAULT 0;

ALTER TABLE finnor_os.workflow_steps
  DROP CONSTRAINT IF EXISTS workflow_steps_dispatch_generation_check;

ALTER TABLE finnor_os.workflow_steps
  ADD CONSTRAINT workflow_steps_dispatch_generation_check
  CHECK (dispatch_generation >= 0);
