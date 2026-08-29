-- Human Operating Compiler: the public and durable route vocabulary is now
-- QUERY / ATOMIC_ACTION / OBJECTIVE / CONVERSATION / CLARIFY.
--
-- Existing rows are normalized in place. `atomic_effect` remains accepted only
-- as a rolling-deploy/rollback compatibility value while old API instances drain;
-- current code never writes it and every public projection normalizes it.
UPDATE finnor_os.works
SET execution_model='atomic_action',updated_at=now()
WHERE execution_model='atomic_effect';

ALTER TABLE finnor_os.works DROP CONSTRAINT IF EXISTS works_execution_model_check;
ALTER TABLE finnor_os.works ADD CONSTRAINT works_execution_model_check
  CHECK (execution_model IS NULL OR execution_model IN (
    'query','conversation','atomic_action','objective','clarify','atomic_effect'
  ));

COMMENT ON COLUMN finnor_os.works.execution_model IS
  'Canonical compiler route: query, conversation, atomic_action, objective, or clarify. atomic_effect is a read/rollback compatibility value only.';
