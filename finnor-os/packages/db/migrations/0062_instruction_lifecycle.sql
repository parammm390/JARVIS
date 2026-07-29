-- jarvis-v3 P3.T1: the instruction lifecycle trace (plan v3 §7.1/§8 PHASE 3).
-- `instruction_sessions.id` is the CLIENT-minted `instructionId` (kernel/instruction.ts
-- mints it, sends it in POST /api/actions, and polls GET /api/instructions/:id/events
-- with it) — not gen_random_uuid(), so no DEFAULT here; the row is created the moment
-- handleInstruction first sees an instructionId, before the first event is emitted.
-- `instruction_events` is append-only (never updated or deleted, same convention as
-- action_log) with a strictly-increasing `seq` per instruction_id, enforced by the
-- UNIQUE constraint below — emitInstructionEvent()'s INSERT ... SELECT MAX(seq)+1
-- pattern relies on it to make a duplicate seq a constraint violation, not a race.
--
-- NOTE ON PHASE COUNT: the session's own binding instruction describes this vocabulary
-- as "exactly these 14 values", but the literal enumerated list it gives has 15 distinct
-- tokens (received, context_retrieved, planning, plan_ready, clarification_required,
-- action_created, action_gated, dispatched, executing, step_progress, verifying,
-- verified, completed, failed, cancelled). Per this plan's own rule that the literal
-- list governs ("do not invent, rename, or DROP any"), all 15 are included verbatim
-- below; the "14" count appears to be a miscount, not a shorter list to drop one from.
CREATE TABLE IF NOT EXISTS finnor_os.instruction_sessions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  session_id text,
  user_id uuid REFERENCES finnor_os.users(id),
  instruction_text text NOT NULL,
  source text NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'voice')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS instruction_sessions_tenant_idx ON finnor_os.instruction_sessions(tenant_id);

CREATE TABLE IF NOT EXISTS finnor_os.instruction_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  instruction_id uuid NOT NULL REFERENCES finnor_os.instruction_sessions(id),
  seq integer NOT NULL,
  phase text NOT NULL CHECK (phase IN (
    'received', 'context_retrieved', 'planning', 'plan_ready', 'clarification_required',
    'action_created', 'action_gated', 'dispatched', 'executing', 'step_progress',
    'verifying', 'verified', 'completed', 'failed', 'cancelled'
  )),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instruction_id, seq)
);
CREATE INDEX IF NOT EXISTS instruction_events_tenant_idx ON finnor_os.instruction_events(tenant_id);

ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS instruction_id uuid REFERENCES finnor_os.instruction_sessions(id);
CREATE INDEX IF NOT EXISTS domain_actions_instruction_idx ON finnor_os.domain_actions(instruction_id) WHERE instruction_id IS NOT NULL;

DO $do$
BEGIN
  ALTER TABLE finnor_os.instruction_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.instruction_sessions FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.instruction_sessions;
  CREATE POLICY tenant_isolation ON finnor_os.instruction_sessions
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());

  ALTER TABLE finnor_os.instruction_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE finnor_os.instruction_events FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON finnor_os.instruction_events;
  CREATE POLICY tenant_isolation ON finnor_os.instruction_events
    USING (tenant_id = finnor_os.request_tenant_id())
    WITH CHECK (tenant_id = finnor_os.request_tenant_id());

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.instruction_sessions TO finnor_app;
    GRANT SELECT, INSERT ON finnor_os.instruction_events TO finnor_app;
  END IF;
END $do$;
