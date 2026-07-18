-- Phase 2 (§2.2, JARVIS 95% MAESTRO PACK): DecisionReceipt + dead-letter queue, plus a
-- versioned envelope on the two message tables the runtime already has. Additive only
-- (expand phase) — no existing column/table changes shape, matching migrations/0009's
-- RLS + index conventions exactly.

CREATE TABLE IF NOT EXISTS finnor_os.decision_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  workflow_run_id uuid REFERENCES finnor_os.workflow_runs(id),
  workflow_step_id uuid REFERENCES finnor_os.workflow_steps(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  objective text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  policy_applied jsonb,
  risk_tier text NOT NULL DEFAULT 'medium' CHECK (risk_tier IN ('low','medium','high')),
  proposed_action jsonb NOT NULL DEFAULT '{}',
  approval jsonb NOT NULL DEFAULT '{"required": false}',
  expected_result jsonb,
  actual_result jsonb,
  failure jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  UNIQUE (workflow_step_id)
);
CREATE INDEX IF NOT EXISTS decision_receipts_tenant_created_idx ON finnor_os.decision_receipts (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS finnor_os.dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  related_outbox_event_id uuid REFERENCES finnor_os.outbox_events(id),
  related_workflow_step_id uuid REFERENCES finnor_os.workflow_steps(id),
  envelope jsonb NOT NULL,
  error_kind text NOT NULL CHECK (error_kind IN ('retryable','terminal','conflict','auth','validation','provider_down')),
  attempts integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL,
  replayable boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','replayed','discarded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS dead_letters_tenant_status_idx ON finnor_os.dead_letters (tenant_id, status);

-- Versioned event envelope (§2.2b): every inbox/outbox message already carries
-- tenant_id/type/payload/timestamp as real columns — the only missing piece of the
-- envelope shape is a major version so a consumer can reject an envelope it doesn't
-- understand into the DLQ instead of misinterpreting a future payload shape.
ALTER TABLE finnor_os.outbox_events ADD COLUMN IF NOT EXISTS envelope_version integer NOT NULL DEFAULT 1;
ALTER TABLE finnor_os.inbox_events ADD COLUMN IF NOT EXISTS envelope_version integer NOT NULL DEFAULT 1;

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['decision_receipts','dead_letters'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I;
       CREATE POLICY tenant_isolation ON finnor_os.%I
         USING (tenant_id = finnor_os.request_tenant_id())
         WITH CHECK (tenant_id = finnor_os.request_tenant_id())', t, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.%I TO finnor_app', t);
    END IF;
  END LOOP;
END $do$;
