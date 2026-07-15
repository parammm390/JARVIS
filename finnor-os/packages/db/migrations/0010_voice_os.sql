-- Voice OS (Phase 5, docs/jarvis-90-execution-blueprint.md §5): real caller identity,
-- session/turn history, and confirmations bound to a specific action instead of "the
-- newest pending action tenant-wide." Replaces webhooks/vapi/route.ts's hardcoded
-- owner userId/role and its "confirm the newest pending domain_actions" heuristic.
-- Same RLS convention as migrations/0008-0009.

CREATE TABLE IF NOT EXISTS finnor_os.voice_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  phone_number text NOT NULL,
  matched_household_id uuid REFERENCES finnor_os.households(id),
  matched_user_id uuid REFERENCES finnor_os.users(id),
  role text NOT NULL DEFAULT 'unknown' CHECK (role IN ('owner','dispatcher','technician','customer','unknown')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_number)
);

CREATE TABLE IF NOT EXISTS finnor_os.voice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  call_external_id text NOT NULL,
  voice_identity_id uuid REFERENCES finnor_os.voice_identities(id),
  channel text NOT NULL DEFAULT 'vapi',
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  UNIQUE (call_external_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.voice_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  voice_session_id uuid NOT NULL REFERENCES finnor_os.voice_sessions(id),
  sequence integer NOT NULL,
  role text NOT NULL CHECK (role IN ('caller','assistant')),
  transcript_text text NOT NULL,
  resolved_action_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voice_session_id, sequence)
);

-- The row finnor_confirm resolves against — binds a spoken yes/no to the exact
-- domain_action this session's own finnor_instruct drafted, not "whatever is newest."
CREATE TABLE IF NOT EXISTS finnor_os.pending_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  voice_session_id uuid NOT NULL REFERENCES finnor_os.voice_sessions(id),
  domain_action_id uuid NOT NULL REFERENCES finnor_os.domain_actions(id),
  prompt_text text NOT NULL,
  status text NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','confirmed','rejected','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS pending_confirmations_awaiting_idx ON finnor_os.pending_confirmations (voice_session_id, status) WHERE status = 'awaiting';

CREATE TABLE IF NOT EXISTS finnor_os.handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  voice_session_id uuid NOT NULL REFERENCES finnor_os.voice_sessions(id),
  reason text NOT NULL,
  to_role text,
  to_user_id uuid REFERENCES finnor_os.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'voice_identities','voice_sessions','voice_turns','pending_confirmations','handoffs'
  ] LOOP
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
