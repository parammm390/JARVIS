-- Phase 6: authenticated-employee conversation and context kernel.
--
-- This is intentionally additive. Work remains the operational envelope; domain
-- actions, Business Effects, authority, durable execution, CRM, and Company Twin
-- remain their existing sources of truth. These tables only retain the private
-- human conversation, its provenance, explicit personal preferences, and links to
-- those existing records.

DO $phase6_parent_keys$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='work_inputs_tenant_id_id_key') THEN
    ALTER TABLE finnor_os.work_inputs ADD CONSTRAINT work_inputs_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
END $phase6_parent_keys$;

CREATE TABLE IF NOT EXISTS finnor_os.employee_conversation_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  owner_employee_id uuid NOT NULL REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility='private'),
  title text,
  summary text,
  summary_through_sequence integer NOT NULL DEFAULT 0 CHECK (summary_through_sequence>=0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  active_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  active_work_id uuid REFERENCES finnor_os.works(id),
  active_objective_loop_id uuid REFERENCES finnor_os.work_objective_loops(id),
  outcome_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin_transport_key text,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_conversation_threads_tenant_id_owner_key UNIQUE (tenant_id,id,owner_employee_id),
  CONSTRAINT employee_conversation_threads_owner_tenant_fkey FOREIGN KEY (tenant_id,owner_employee_id) REFERENCES finnor_os.users(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT employee_conversation_threads_work_tenant_fkey FOREIGN KEY (tenant_id,active_work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT employee_conversation_threads_objective_tenant_fkey FOREIGN KEY (tenant_id,active_objective_loop_id) REFERENCES finnor_os.work_objective_loops(tenant_id,id),
  CONSTRAINT employee_conversation_threads_title_check CHECK (title IS NULL OR (btrim(title)<>'' AND octet_length(title)<=500)),
  CONSTRAINT employee_conversation_threads_summary_check CHECK (summary IS NULL OR octet_length(summary)<=65536),
  CONSTRAINT employee_conversation_threads_refs_check CHECK (
    jsonb_typeof(active_references)='array' AND jsonb_array_length(active_references)<=100
    AND jsonb_typeof(unresolved_references)='array' AND jsonb_array_length(unresolved_references)<=100
    AND jsonb_typeof(outcome_refs)='array' AND jsonb_array_length(outcome_refs)<=200
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_conversation_threads_transport_key
  ON finnor_os.employee_conversation_threads(tenant_id,owner_employee_id,origin_transport_key)
  WHERE origin_transport_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS employee_conversation_threads_owner_activity_idx
  ON finnor_os.employee_conversation_threads(tenant_id,owner_employee_id,last_activity_at DESC,id);

CREATE TABLE IF NOT EXISTS finnor_os.employee_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  thread_id uuid NOT NULL REFERENCES finnor_os.employee_conversation_threads(id) ON DELETE CASCADE,
  owner_employee_id uuid NOT NULL REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence>0),
  role text NOT NULL CHECK (role IN ('user','assistant')),
  channel text NOT NULL CHECK (channel IN ('voice','text','console')),
  author_employee_id uuid REFERENCES finnor_os.users(id),
  original_text text NOT NULL CHECK (btrim(original_text)<>'' AND octet_length(original_text)<=65536),
  instruction_id uuid,
  work_id uuid REFERENCES finnor_os.works(id),
  work_input_id uuid REFERENCES finnor_os.work_inputs(id),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key)<>'' AND octet_length(idempotency_key)<=500),
  transport_session_id text,
  transport_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_snapshot jsonb,
  resolution_provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  company_truth_snapshot jsonb,
  outcome_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_conversation_messages_tenant_id_owner_key UNIQUE (tenant_id,id,owner_employee_id),
  CONSTRAINT employee_conversation_messages_thread_sequence_key UNIQUE (thread_id,sequence),
  CONSTRAINT employee_conversation_messages_thread_idempotency_key UNIQUE (thread_id,idempotency_key),
  CONSTRAINT employee_conversation_messages_thread_owner_fkey FOREIGN KEY (tenant_id,thread_id,owner_employee_id) REFERENCES finnor_os.employee_conversation_threads(tenant_id,id,owner_employee_id) ON DELETE CASCADE,
  CONSTRAINT employee_conversation_messages_author_tenant_fkey FOREIGN KEY (tenant_id,author_employee_id) REFERENCES finnor_os.users(tenant_id,id),
  CONSTRAINT employee_conversation_messages_work_tenant_fkey FOREIGN KEY (tenant_id,work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT employee_conversation_messages_work_input_tenant_fkey FOREIGN KEY (tenant_id,work_input_id) REFERENCES finnor_os.work_inputs(tenant_id,id),
  CONSTRAINT employee_conversation_messages_author_check CHECK (
    (role='user' AND author_employee_id=owner_employee_id)
    OR (role='assistant' AND author_employee_id IS NULL)
  ),
  CONSTRAINT employee_conversation_messages_json_check CHECK (
    jsonb_typeof(transport_provenance)='object'
    AND (resolution_snapshot IS NULL OR jsonb_typeof(resolution_snapshot)='object')
    AND jsonb_typeof(resolution_provenance)='array' AND jsonb_array_length(resolution_provenance)<=100
    AND (company_truth_snapshot IS NULL OR jsonb_typeof(company_truth_snapshot)='object')
    AND jsonb_typeof(outcome_refs)='array' AND jsonb_array_length(outcome_refs)<=200
  )
);
CREATE INDEX IF NOT EXISTS employee_conversation_messages_owner_created_idx
  ON finnor_os.employee_conversation_messages(tenant_id,owner_employee_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS employee_conversation_messages_thread_created_idx
  ON finnor_os.employee_conversation_messages(thread_id,sequence DESC);
CREATE INDEX IF NOT EXISTS employee_conversation_messages_text_search_idx
  ON finnor_os.employee_conversation_messages USING gin (to_tsvector('simple',original_text));

CREATE TABLE IF NOT EXISTS finnor_os.employee_personal_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  owner_employee_id uuid NOT NULL REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  source_thread_id uuid NOT NULL REFERENCES finnor_os.employee_conversation_threads(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES finnor_os.employee_conversation_messages(id) ON DELETE CASCADE,
  memory_type text NOT NULL CHECK (memory_type IN ('preference','proposition')),
  subject_key text NOT NULL CHECK (btrim(subject_key)<>'' AND octet_length(subject_key)<=500),
  proposition text NOT NULL CHECK (btrim(proposition)<>'' AND octet_length(proposition)<=10000),
  structured_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by_id uuid REFERENCES finnor_os.employee_personal_memories(id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_personal_memories_tenant_id_owner_key UNIQUE (tenant_id,id,owner_employee_id),
  CONSTRAINT employee_personal_memories_owner_tenant_fkey FOREIGN KEY (tenant_id,owner_employee_id) REFERENCES finnor_os.users(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT employee_personal_memories_thread_owner_fkey FOREIGN KEY (tenant_id,source_thread_id,owner_employee_id) REFERENCES finnor_os.employee_conversation_threads(tenant_id,id,owner_employee_id) ON DELETE CASCADE,
  CONSTRAINT employee_personal_memories_message_owner_fkey FOREIGN KEY (tenant_id,source_message_id,owner_employee_id) REFERENCES finnor_os.employee_conversation_messages(tenant_id,id,owner_employee_id) ON DELETE CASCADE,
  CONSTRAINT employee_personal_memories_value_check CHECK (jsonb_typeof(structured_value)='object' AND jsonb_typeof(provenance)='object'),
  CONSTRAINT employee_personal_memories_supersession_check CHECK (
    (superseded_at IS NULL AND superseded_by_id IS NULL)
    OR (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_personal_memories_active_subject_key
  ON finnor_os.employee_personal_memories(tenant_id,owner_employee_id,subject_key)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS employee_personal_memories_owner_subject_idx
  ON finnor_os.employee_personal_memories(tenant_id,owner_employee_id,subject_key,valid_from DESC);

CREATE TABLE IF NOT EXISTS finnor_os.legacy_zep_graph_quarantine (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id) ON DELETE CASCADE,
  legacy_user_id text NOT NULL,
  policy text NOT NULL DEFAULT 'quarantined_no_query_no_copy' CHECK (policy='quarantined_no_query_no_copy'),
  reason text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO finnor_os.legacy_zep_graph_quarantine (tenant_id,legacy_user_id,reason)
SELECT id,'finnor-tenant-' || id::text,'Pre-Phase-6 tenant-wide graphs have no deterministic employee provenance.'
FROM finnor_os.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- The owner predicate is identical at all three private layers. No app.user_id
-- means zero rows, so service principals cannot accidentally acquire human memory.
DO $private_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'employee_conversation_threads','employee_conversation_messages','employee_personal_memories'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS employee_self_only ON finnor_os.%I',table_name);
    EXECUTE format(
      'CREATE POLICY employee_self_only ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id() AND owner_employee_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid) WITH CHECK (tenant_id=finnor_os.request_tenant_id() AND owner_employee_id=NULLIF(current_setting(''app.user_id'',true),'''')::uuid)',
      table_name
    );
  END LOOP;
END $private_rls$;

ALTER TABLE finnor_os.legacy_zep_graph_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.legacy_zep_graph_quarantine FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.legacy_zep_graph_quarantine;
CREATE POLICY tenant_isolation ON finnor_os.legacy_zep_graph_quarantine
  USING (tenant_id=finnor_os.request_tenant_id())
  WITH CHECK (tenant_id=finnor_os.request_tenant_id());

DO $grants$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'employee_conversation_threads','employee_conversation_messages','employee_personal_memories'
    ] LOOP
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.%I TO finnor_app',table_name);
    END LOOP;
    GRANT SELECT ON finnor_os.legacy_zep_graph_quarantine TO finnor_app;
  END IF;
END $grants$;
