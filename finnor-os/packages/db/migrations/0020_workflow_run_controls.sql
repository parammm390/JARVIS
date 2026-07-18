-- Phase 2 (§2.7): run controls (pause/resume/cancel/retry/escalate) need two things
-- workflow_runs doesn't have yet: an optimistic-concurrency version column (so two
-- concurrent control calls can't both believe they made the transition), and three new
-- terminal/paused states the existing status enum has no room for.

ALTER TABLE finnor_os.workflow_runs ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE finnor_os.workflow_runs
  DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE finnor_os.workflow_runs
  ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'compensating', 'compensated', 'paused', 'cancelled', 'escalated'));
