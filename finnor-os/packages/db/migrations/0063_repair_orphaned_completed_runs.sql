-- Synchronous single-action execution completes its workflow step in the API
-- process. Older deployments forgot the matching advanceWorkflow() call, leaving
-- runs and their parent commands marked `running` even though every step and
-- domain action was already terminal. Repair only rows whose entire step set is
-- provably completed; rows with pending/leased/failed steps are untouched.

WITH completed_runs AS (
  SELECT r.id, r.command_id
  FROM finnor_os.workflow_runs r
  WHERE r.status = 'running'
    AND EXISTS (
      SELECT 1
      FROM finnor_os.workflow_steps s
      WHERE s.workflow_run_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM finnor_os.workflow_steps s
      WHERE s.workflow_run_id = r.id
        AND s.status <> 'completed'
    )
)
UPDATE finnor_os.workflow_runs r
SET status = 'completed', version = r.version + 1, updated_at = now()
FROM completed_runs c
WHERE r.id = c.id;

WITH completed_runs AS (
  SELECT r.command_id
  FROM finnor_os.workflow_runs r
  WHERE r.status = 'completed'
    AND NOT EXISTS (
      SELECT 1
      FROM finnor_os.workflow_steps s
      WHERE s.workflow_run_id = r.id
        AND s.status <> 'completed'
    )
)
UPDATE finnor_os.commands c
SET status = 'completed', updated_at = now()
FROM completed_runs r
WHERE c.id = r.command_id
  AND c.status = 'running';
