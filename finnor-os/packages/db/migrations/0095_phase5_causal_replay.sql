-- Phase 5 Operational Time Machine: add only the missing immutable provenance to
-- the existing Work spine. The replay itself is a read model and owns no lifecycle.

ALTER TABLE finnor_os.work_inputs
  ADD COLUMN IF NOT EXISTS context_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS context_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS context_captured_at timestamptz;

ALTER TABLE finnor_os.work_inputs DROP CONSTRAINT IF EXISTS work_inputs_context_snapshot_object_check;
ALTER TABLE finnor_os.work_inputs ADD CONSTRAINT work_inputs_context_snapshot_object_check
  CHECK (context_snapshot IS NULL OR jsonb_typeof(context_snapshot)='object');
ALTER TABLE finnor_os.work_inputs DROP CONSTRAINT IF EXISTS work_inputs_context_snapshot_hash_check;
ALTER TABLE finnor_os.work_inputs ADD CONSTRAINT work_inputs_context_snapshot_hash_check
  CHECK (context_snapshot_hash IS NULL OR context_snapshot_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE finnor_os.work_inputs DROP CONSTRAINT IF EXISTS work_inputs_context_snapshot_complete_check;
ALTER TABLE finnor_os.work_inputs ADD CONSTRAINT work_inputs_context_snapshot_complete_check CHECK (
  (context_snapshot IS NULL AND context_snapshot_hash IS NULL AND context_captured_at IS NULL)
  OR (context_snapshot IS NOT NULL AND context_snapshot_hash IS NOT NULL AND context_captured_at IS NOT NULL)
);
ALTER TABLE finnor_os.work_inputs DROP CONSTRAINT IF EXISTS work_inputs_context_snapshot_bound_check;
ALTER TABLE finnor_os.work_inputs ADD CONSTRAINT work_inputs_context_snapshot_bound_check
  CHECK (context_snapshot IS NULL OR octet_length(context_snapshot::text) <= 65536);

ALTER TABLE finnor_os.work_planner_attempts
  ADD COLUMN IF NOT EXISTS decision_context_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS decision_context_hash text,
  ADD COLUMN IF NOT EXISTS decision_context_captured_at timestamptz;

ALTER TABLE finnor_os.work_planner_attempts DROP CONSTRAINT IF EXISTS work_planner_attempts_decision_context_object_check;
ALTER TABLE finnor_os.work_planner_attempts ADD CONSTRAINT work_planner_attempts_decision_context_object_check
  CHECK (decision_context_snapshot IS NULL OR jsonb_typeof(decision_context_snapshot)='object');
ALTER TABLE finnor_os.work_planner_attempts DROP CONSTRAINT IF EXISTS work_planner_attempts_decision_context_hash_check;
ALTER TABLE finnor_os.work_planner_attempts ADD CONSTRAINT work_planner_attempts_decision_context_hash_check
  CHECK (decision_context_hash IS NULL OR decision_context_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE finnor_os.work_planner_attempts DROP CONSTRAINT IF EXISTS work_planner_attempts_decision_context_complete_check;
ALTER TABLE finnor_os.work_planner_attempts ADD CONSTRAINT work_planner_attempts_decision_context_complete_check CHECK (
  (decision_context_snapshot IS NULL AND decision_context_hash IS NULL AND decision_context_captured_at IS NULL)
  OR (decision_context_snapshot IS NOT NULL AND decision_context_hash IS NOT NULL AND decision_context_captured_at IS NOT NULL)
);
ALTER TABLE finnor_os.work_planner_attempts DROP CONSTRAINT IF EXISTS work_planner_attempts_decision_context_bound_check;
ALTER TABLE finnor_os.work_planner_attempts ADD CONSTRAINT work_planner_attempts_decision_context_bound_check
  CHECK (decision_context_snapshot IS NULL OR octet_length(decision_context_snapshot::text) <= 65536);

-- Only the new provenance columns are frozen. Planner attempt status/result fields
-- retain their existing legal planning -> terminal update path.
CREATE OR REPLACE FUNCTION finnor_os.guard_work_input_context_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF (
    NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot
    OR NEW.context_snapshot_hash IS DISTINCT FROM OLD.context_snapshot_hash
    OR NEW.context_captured_at IS DISTINCT FROM OLD.context_captured_at
  ) THEN
    RAISE EXCEPTION 'Work input context provenance is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_work_input_context_provenance() FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.guard_work_planner_context_provenance() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF (
    NEW.decision_context_snapshot IS DISTINCT FROM OLD.decision_context_snapshot
    OR NEW.decision_context_hash IS DISTINCT FROM OLD.decision_context_hash
    OR NEW.decision_context_captured_at IS DISTINCT FROM OLD.decision_context_captured_at
  ) THEN
    RAISE EXCEPTION 'Planner decision context provenance is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_work_planner_context_provenance() FROM PUBLIC;

DROP TRIGGER IF EXISTS work_inputs_context_provenance_immutable ON finnor_os.work_inputs;
CREATE TRIGGER work_inputs_context_provenance_immutable
  BEFORE UPDATE ON finnor_os.work_inputs
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_work_input_context_provenance();

DROP TRIGGER IF EXISTS work_planner_attempts_context_provenance_immutable ON finnor_os.work_planner_attempts;
CREATE TRIGGER work_planner_attempts_context_provenance_immutable
  BEFORE UPDATE ON finnor_os.work_planner_attempts
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_work_planner_context_provenance();

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT EXECUTE ON FUNCTION finnor_os.guard_work_input_context_provenance() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_work_planner_context_provenance() TO finnor_app;
  END IF;
END $grants$;

COMMENT ON COLUMN finnor_os.work_inputs.context_snapshot IS
  'Immutable, bounded Operating Interaction Context captured at instruction intake; null on legacy inputs.';
COMMENT ON COLUMN finnor_os.work_planner_attempts.decision_context_snapshot IS
  'Immutable, bounded decision-time provenance assembled before planning; contains no prompts, secrets, or private model reasoning.';
