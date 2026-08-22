-- Phase 4: canonical integration/runtime events + durable Objective Loop waits.
--
-- Events are observations. They may satisfy an exact stored wait and enqueue one
-- Objective Loop iteration; they never encode or execute a business action.

-- The legacy inbox replay key was global across tenants. Provider event IDs are only
-- unique inside a tenant/provider account, so make the durable claim tenant-scoped.
ALTER TABLE finnor_os.inbox_events DROP CONSTRAINT IF EXISTS inbox_events_provider_event_idx;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_events_provider_event_idx
  ON finnor_os.inbox_events(tenant_id,provider,event_id);

CREATE TABLE IF NOT EXISTS finnor_os.integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 120),
  provider text,
  source_event_id text NOT NULL CHECK (char_length(source_event_id) BETWEEN 1 AND 500),
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  party_type text,
  party_id uuid,
  resource_type text,
  resource_id uuid,
  work_id uuid REFERENCES finnor_os.works(id),
  task_id uuid REFERENCES finnor_os.tasks(id),
  delegation_id uuid REFERENCES finnor_os.delegations(id),
  acknowledgement_request_id uuid REFERENCES finnor_os.acknowledgement_requests(id),
  computer_run_id uuid REFERENCES finnor_os.computer_runs(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  provider_conversation_id text,
  provider_message_id text,
  application_ref text,
  correlation_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  trust_class text NOT NULL DEFAULT 'untrusted_external' CHECK (trust_class IN ('untrusted_external','trusted_runtime')),
  content_treatment text NOT NULL DEFAULT 'untrusted_evidence' CHECK (content_treatment='untrusted_evidence'),
  instruction_eligible boolean NOT NULL DEFAULT false CHECK (instruction_eligible=false),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','matched','unmatched','ignored')),
  matched_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_events_replay_unique UNIQUE (tenant_id,source,source_event_id),
  CONSTRAINT integration_events_party_pair_check CHECK ((party_type IS NULL)=(party_id IS NULL)),
  CONSTRAINT integration_events_resource_pair_check CHECK ((resource_type IS NULL)=(resource_id IS NULL)),
  CONSTRAINT integration_events_payload_object_check CHECK (jsonb_typeof(payload)='object'),
  CONSTRAINT integration_events_evidence_array_check CHECK (jsonb_typeof(evidence_refs)='array'),
  CONSTRAINT integration_events_payload_bound_check CHECK (octet_length(payload::text) <= 65536),
  CONSTRAINT integration_events_evidence_bound_check CHECK (octet_length(evidence_refs::text) <= 32768)
);
CREATE INDEX IF NOT EXISTS integration_events_tenant_type_time_idx
  ON finnor_os.integration_events(tenant_id,event_type,occurred_at DESC);
CREATE INDEX IF NOT EXISTS integration_events_tenant_work_time_idx
  ON finnor_os.integration_events(tenant_id,work_id,occurred_at DESC) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS integration_events_tenant_status_received_idx
  ON finnor_os.integration_events(tenant_id,status,received_at);
CREATE INDEX IF NOT EXISTS integration_events_provider_conversation_idx
  ON finnor_os.integration_events(tenant_id,provider,provider_conversation_id,occurred_at DESC)
  WHERE provider_conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.work_event_waits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  objective_loop_id uuid NOT NULL REFERENCES finnor_os.work_objective_loops(id),
  objective_step_id uuid NOT NULL REFERENCES finnor_os.work_objective_steps(id),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','satisfied','timed_out','cancelled')),
  expected_event_type text NOT NULL CHECK (char_length(expected_event_type) BETWEEN 1 AND 200),
  subject_type text,
  subject_id uuid,
  resource_type text,
  resource_id uuid,
  delegation_id uuid REFERENCES finnor_os.delegations(id),
  task_id uuid REFERENCES finnor_os.tasks(id),
  acknowledgement_request_id uuid REFERENCES finnor_os.acknowledgement_requests(id),
  computer_run_id uuid REFERENCES finnor_os.computer_runs(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  provider text,
  provider_conversation_id text,
  provider_message_id text,
  application_ref text,
  correlation_id text,
  condition_summary text NOT NULL CHECK (char_length(condition_summary) BETWEEN 1 AND 2000),
  continuation_policy jsonb NOT NULL DEFAULT '{"mode":"reinspect_current_state","maxDecisions":1}'::jsonb,
  earliest_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  matched_event_id uuid REFERENCES finnor_os.integration_events(id),
  satisfied_at timestamptz,
  timed_out_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_event_waits_step_unique UNIQUE (objective_step_id),
  CONSTRAINT work_event_waits_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT work_event_waits_subject_pair_check CHECK ((subject_type IS NULL)=(subject_id IS NULL)),
  CONSTRAINT work_event_waits_resource_pair_check CHECK ((resource_type IS NULL)=(resource_id IS NULL)),
  CONSTRAINT work_event_waits_policy_object_check CHECK (jsonb_typeof(continuation_policy)='object'),
  CONSTRAINT work_event_waits_terminal_shape_check CHECK (
    (status='waiting' AND matched_event_id IS NULL AND satisfied_at IS NULL AND timed_out_at IS NULL AND cancelled_at IS NULL)
    OR (status='satisfied' AND matched_event_id IS NOT NULL AND satisfied_at IS NOT NULL AND timed_out_at IS NULL AND cancelled_at IS NULL)
    OR (status='timed_out' AND matched_event_id IS NOT NULL AND satisfied_at IS NULL AND timed_out_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status='cancelled' AND satisfied_at IS NULL AND timed_out_at IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS work_event_waits_tenant_match_idx
  ON finnor_os.work_event_waits(tenant_id,status,expected_event_type,earliest_at);
CREATE INDEX IF NOT EXISTS work_event_waits_tenant_deadline_idx
  ON finnor_os.work_event_waits(tenant_id,status,deadline_at) WHERE deadline_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_event_waits_tenant_work_idx
  ON finnor_os.work_event_waits(tenant_id,work_id,created_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.work_wake_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  wait_id uuid NOT NULL REFERENCES finnor_os.work_event_waits(id),
  integration_event_id uuid NOT NULL REFERENCES finnor_os.integration_events(id),
  objective_loop_id uuid NOT NULL REFERENCES finnor_os.work_objective_loops(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  cause text NOT NULL CHECK (cause IN ('event','deadline')),
  objective_revision integer NOT NULL CHECK (objective_revision > 0),
  job_id uuid NOT NULL REFERENCES finnor_os.jobs(id),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CONSTRAINT work_wake_claims_wait_unique UNIQUE (wait_id),
  CONSTRAINT work_wake_claims_job_unique UNIQUE (job_id),
  CONSTRAINT work_wake_claims_tenant_id_id_key UNIQUE (tenant_id,id)
);
CREATE INDEX IF NOT EXISTS work_wake_claims_tenant_loop_idx
  ON finnor_os.work_wake_claims(tenant_id,objective_loop_id,claimed_at DESC);

-- Owner/test connections can bypass RLS, so relational scope is also enforced by a
-- trigger. This is the fail-closed boundary for forged cross-tenant refs.
CREATE OR REPLACE FUNCTION finnor_os.assert_phase4_event_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE related_tenant uuid; loop_work uuid; step_loop uuid; step_work uuid; wait_tenant uuid;
BEGIN
  IF TG_TABLE_NAME='integration_events' THEN
    IF NEW.party_id IS NOT NULL THEN related_tenant := finnor_os.party_ref_tenant(NEW.party_type,NEW.party_id); IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event PartyRef crosses tenant boundary or does not exist'; END IF; END IF;
    IF NEW.resource_id IS NOT NULL THEN
      IF NEW.resource_type='work_event_wait' THEN SELECT tenant_id INTO related_tenant FROM finnor_os.work_event_waits WHERE id=NEW.resource_id;
      ELSIF NEW.resource_type='computer_run' THEN SELECT tenant_id INTO related_tenant FROM finnor_os.computer_runs WHERE id=NEW.resource_id;
      ELSE related_tenant := finnor_os.canonical_entity_tenant(NEW.resource_type,NEW.resource_id); END IF;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event resource crosses tenant boundary or does not exist'; END IF;
    END IF;
    IF NEW.work_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.works WHERE id=NEW.work_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event Work crosses tenant boundary'; END IF; END IF;
    IF NEW.task_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.tasks WHERE id=NEW.task_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event task crosses tenant boundary'; END IF; END IF;
    IF NEW.delegation_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.delegations WHERE id=NEW.delegation_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event delegation crosses tenant boundary'; END IF; END IF;
    IF NEW.acknowledgement_request_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.acknowledgement_requests WHERE id=NEW.acknowledgement_request_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event acknowledgement crosses tenant boundary'; END IF; END IF;
    IF NEW.computer_run_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.computer_runs WHERE id=NEW.computer_run_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event computer run crosses tenant boundary'; END IF; END IF;
    IF NEW.domain_action_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'integration event action crosses tenant boundary'; END IF; END IF;
  ELSIF TG_TABLE_NAME='work_event_waits' THEN
    SELECT tenant_id INTO related_tenant FROM finnor_os.works WHERE id=NEW.work_id;
    SELECT work_id INTO loop_work FROM finnor_os.work_objective_loops WHERE id=NEW.objective_loop_id AND tenant_id=NEW.tenant_id;
    SELECT objective_loop_id,work_id INTO step_loop,step_work FROM finnor_os.work_objective_steps WHERE id=NEW.objective_step_id AND tenant_id=NEW.tenant_id;
    IF related_tenant IS DISTINCT FROM NEW.tenant_id OR loop_work IS DISTINCT FROM NEW.work_id OR step_loop IS DISTINCT FROM NEW.objective_loop_id OR step_work IS DISTINCT FROM NEW.work_id THEN RAISE EXCEPTION 'event wait crosses tenant, Work, loop, or step boundary'; END IF;
    IF NEW.subject_id IS NOT NULL THEN related_tenant := finnor_os.party_ref_tenant(NEW.subject_type,NEW.subject_id); IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait PartyRef crosses tenant boundary or does not exist'; END IF; END IF;
    IF NEW.resource_id IS NOT NULL THEN
      IF NEW.resource_type='computer_run' THEN SELECT tenant_id INTO related_tenant FROM finnor_os.computer_runs WHERE id=NEW.resource_id;
      ELSE related_tenant := finnor_os.canonical_entity_tenant(NEW.resource_type,NEW.resource_id); END IF;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait resource crosses tenant boundary or does not exist'; END IF;
    END IF;
    IF NEW.task_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.tasks WHERE id=NEW.task_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait task crosses tenant boundary'; END IF; END IF;
    IF NEW.delegation_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.delegations WHERE id=NEW.delegation_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait delegation crosses tenant boundary'; END IF; END IF;
    IF NEW.acknowledgement_request_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.acknowledgement_requests WHERE id=NEW.acknowledgement_request_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait acknowledgement crosses tenant boundary'; END IF; END IF;
    IF NEW.computer_run_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.computer_runs WHERE id=NEW.computer_run_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait computer run crosses tenant boundary'; END IF; END IF;
    IF NEW.domain_action_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait action crosses tenant boundary'; END IF; END IF;
    IF NEW.matched_event_id IS NOT NULL THEN SELECT tenant_id INTO related_tenant FROM finnor_os.integration_events WHERE id=NEW.matched_event_id; IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'event wait match crosses tenant boundary'; END IF; END IF;
  ELSIF TG_TABLE_NAME='work_wake_claims' THEN
    SELECT tenant_id INTO wait_tenant FROM finnor_os.work_event_waits WHERE id=NEW.wait_id AND work_id=NEW.work_id AND objective_loop_id=NEW.objective_loop_id;
    SELECT tenant_id INTO related_tenant FROM finnor_os.integration_events WHERE id=NEW.integration_event_id;
    IF wait_tenant IS DISTINCT FROM NEW.tenant_id OR related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'wake claim crosses tenant or wait boundary'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.assert_phase4_event_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS integration_events_scope ON finnor_os.integration_events;
CREATE TRIGGER integration_events_scope BEFORE INSERT OR UPDATE ON finnor_os.integration_events FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_phase4_event_scope();
DROP TRIGGER IF EXISTS work_event_waits_scope ON finnor_os.work_event_waits;
CREATE TRIGGER work_event_waits_scope BEFORE INSERT OR UPDATE ON finnor_os.work_event_waits FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_phase4_event_scope();
DROP TRIGGER IF EXISTS work_wake_claims_scope ON finnor_os.work_wake_claims;
CREATE TRIGGER work_wake_claims_scope BEFORE INSERT OR UPDATE ON finnor_os.work_wake_claims FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_phase4_event_scope();

-- Correlation identity is immutable; processing state may only advance. Waits may
-- move exactly once out of waiting. A stale event/deadline race therefore cannot
-- create contradictory terminal states even for a table owner.
CREATE OR REPLACE FUNCTION finnor_os.guard_phase4_event_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF TG_TABLE_NAME='integration_events' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.source_event_id IS DISTINCT FROM OLD.source_event_id OR NEW.event_type IS DISTINCT FROM OLD.event_type OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at OR NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.party_type IS DISTINCT FROM OLD.party_type OR NEW.party_id IS DISTINCT FROM OLD.party_id OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.delegation_id IS DISTINCT FROM OLD.delegation_id OR NEW.acknowledgement_request_id IS DISTINCT FROM OLD.acknowledgement_request_id OR NEW.computer_run_id IS DISTINCT FROM OLD.computer_run_id OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id OR NEW.provider_conversation_id IS DISTINCT FROM OLD.provider_conversation_id OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id OR NEW.application_ref IS DISTINCT FROM OLD.application_ref OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs OR NEW.trust_class IS DISTINCT FROM OLD.trust_class OR NEW.content_treatment IS DISTINCT FROM OLD.content_treatment OR NEW.instruction_eligible IS DISTINCT FROM OLD.instruction_eligible OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'integration event evidence envelope is immutable'; END IF;
    IF OLD.status='matched' AND NEW.status<>'matched' THEN RAISE EXCEPTION 'matched integration event cannot regress'; END IF;
    IF OLD.status='ignored' AND NEW.status<>'ignored' THEN RAISE EXCEPTION 'ignored integration event cannot regress'; END IF;
  ELSIF TG_TABLE_NAME='work_event_waits' THEN
    IF OLD.status<>'waiting' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'terminal event wait is immutable'; END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.objective_loop_id IS DISTINCT FROM OLD.objective_loop_id OR NEW.objective_step_id IS DISTINCT FROM OLD.objective_step_id OR NEW.expected_event_type IS DISTINCT FROM OLD.expected_event_type OR NEW.subject_type IS DISTINCT FROM OLD.subject_type OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.resource_type IS DISTINCT FROM OLD.resource_type OR NEW.resource_id IS DISTINCT FROM OLD.resource_id OR NEW.delegation_id IS DISTINCT FROM OLD.delegation_id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.acknowledgement_request_id IS DISTINCT FROM OLD.acknowledgement_request_id OR NEW.computer_run_id IS DISTINCT FROM OLD.computer_run_id OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.provider_conversation_id IS DISTINCT FROM OLD.provider_conversation_id OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id OR NEW.application_ref IS DISTINCT FROM OLD.application_ref OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.condition_summary IS DISTINCT FROM OLD.condition_summary OR NEW.earliest_at IS DISTINCT FROM OLD.earliest_at OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at OR NEW.continuation_policy IS DISTINCT FROM OLD.continuation_policy OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'event wait correlation contract is immutable'; END IF;
  ELSIF TG_TABLE_NAME='work_wake_claims' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.wait_id IS DISTINCT FROM OLD.wait_id OR NEW.integration_event_id IS DISTINCT FROM OLD.integration_event_id OR NEW.objective_loop_id IS DISTINCT FROM OLD.objective_loop_id OR NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.cause IS DISTINCT FROM OLD.cause OR NEW.objective_revision IS DISTINCT FROM OLD.objective_revision OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN RAISE EXCEPTION 'wake claim is immutable'; END IF;
    IF OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at THEN RAISE EXCEPTION 'consumed wake claim cannot regress or be rewritten'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_phase4_event_transition() FROM PUBLIC;

DROP TRIGGER IF EXISTS integration_events_transition_guard ON finnor_os.integration_events;
CREATE TRIGGER integration_events_transition_guard BEFORE UPDATE ON finnor_os.integration_events FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_phase4_event_transition();
DROP TRIGGER IF EXISTS work_event_waits_transition_guard ON finnor_os.work_event_waits;
CREATE TRIGGER work_event_waits_transition_guard BEFORE UPDATE ON finnor_os.work_event_waits FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_phase4_event_transition();
DROP TRIGGER IF EXISTS work_wake_claims_transition_guard ON finnor_os.work_wake_claims;
CREATE TRIGGER work_wake_claims_transition_guard BEFORE UPDATE ON finnor_os.work_wake_claims FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_phase4_event_transition();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['integration_events','work_event_waits','work_wake_claims'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.integration_events,finnor_os.work_event_waits,finnor_os.work_wake_claims TO finnor_app;
    REVOKE DELETE ON finnor_os.integration_events,finnor_os.work_event_waits,finnor_os.work_wake_claims FROM finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_phase4_event_scope(),finnor_os.guard_phase4_event_transition() TO finnor_app;
  END IF;
END $rls$;

-- Existing realtime remains transport. Only IDs and event kinds leave Postgres;
-- clients refetch tenant-scoped canonical state after reconnect.
DROP TRIGGER IF EXISTS integration_events_notify ON finnor_os.integration_events;
CREATE TRIGGER integration_events_notify AFTER INSERT OR UPDATE OF status ON finnor_os.integration_events FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('integration_event');
DROP TRIGGER IF EXISTS work_event_waits_notify ON finnor_os.work_event_waits;
CREATE TRIGGER work_event_waits_notify AFTER INSERT OR UPDATE OF status ON finnor_os.work_event_waits FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('work_event_wait');

-- Inbound paths that do not yet know a tenant cannot query FORCE-RLS integration
-- rows directly. This narrow resolver reveals only one UUID for one exact signed
-- provider reference and fails closed on zero or ambiguous matches.
CREATE OR REPLACE FUNCTION finnor_os.resolve_inbound_provider_tenant(provider_name text, external_ref text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
  WITH candidates AS (
    SELECT tenant_id
    FROM finnor_os.tenant_integrations
    WHERE (binding=provider_name OR capability=provider_name
      OR (provider_name='marketing_conversion' AND capability='marketing')
      OR (provider_name='payment_emulator' AND capability='payments'))
      AND (
        config->>'locationId'=external_ref OR credential_metadata->>'locationId'=external_ref
        OR config->>'accountId'=external_ref OR credential_metadata->>'accountId'=external_ref
        OR config->>'webhookRouteId'=external_ref OR credential_metadata->>'webhookRouteId'=external_ref
      )
    UNION
    SELECT tenant_id FROM finnor_os.external_refs WHERE provider=provider_name AND external_id=external_ref
  )
  SELECT CASE WHEN count(*)=1 THEN min(tenant_id::text)::uuid ELSE NULL END FROM candidates
$$;
REVOKE ALL ON FUNCTION finnor_os.resolve_inbound_provider_tenant(text,text) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
  GRANT EXECUTE ON FUNCTION finnor_os.resolve_inbound_provider_tenant(text,text) TO finnor_app;
END IF; END $grant$;
