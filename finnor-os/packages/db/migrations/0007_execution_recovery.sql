-- Durable recovery for work claimed by a worker that later crashes or is killed.
-- A running job must never remain invisible forever: the queue reclaims it after
-- its lease and either retries it with backoff or dead-letters it honestly.

ALTER TABLE finnor_os.jobs
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
CREATE INDEX IF NOT EXISTS jobs_running_started_at_idx
  ON finnor_os.jobs (started_at) WHERE status = 'running';

-- Records when a domain action entered its side-effecting phase. This is deliberately
-- separate from created_at: recovery/reconciliation must never guess based on when a
-- draft was made. Action-specific reconcilers will use this lease marker.
ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS execution_started_at timestamptz;
CREATE INDEX IF NOT EXISTS domain_actions_executing_started_at_idx
  ON finnor_os.domain_actions (execution_started_at) WHERE status = 'executing';

-- A process can die after sending a request and before recording its response. That
-- is not a normal failure: retrying blindly could duplicate a real-world side effect.
-- `unknown` forces reconciliation/review before any replay.
ALTER TABLE finnor_os.external_operations
  DROP CONSTRAINT IF EXISTS external_operations_status_check;
ALTER TABLE finnor_os.external_operations
  ADD CONSTRAINT external_operations_status_check
  CHECK (status IN ('running', 'succeeded', 'failed', 'unknown'));
