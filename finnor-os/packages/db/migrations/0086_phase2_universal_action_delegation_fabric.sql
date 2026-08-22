-- Phase 2 Universal Action + Delegation Fabric. Additive and replay-safe.
-- Delivery, acknowledgement, acceptance, and completion are separate durable facts.

ALTER TABLE finnor_os.tenant_settings
  ADD COLUMN IF NOT EXISTS universal_action_config jsonb NOT NULL DEFAULT jsonb_build_object(
    'communication',jsonb_build_object('allowedChannels',jsonb_build_array('internal','email','sms','voice'),'allowChannelFallback',false,'maxGroupRecipients',50),
    'acknowledgements',jsonb_build_object('defaultDeadlineMinutes',240),
    'delegations',jsonb_build_object('defaultAckDeadlineMinutes',240,'defaultCompletionHours',24),
    'scheduling',jsonb_build_object('externalCalendarMode','internal_only'),
    'documentSharing',jsonb_build_object('allowExternal',false)
  );

ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_universal_action_config_object_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_universal_action_config_object_check
  CHECK (jsonb_typeof(universal_action_config)='object');
ALTER TABLE finnor_os.tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_universal_action_config_no_secrets_check;
ALTER TABLE finnor_os.tenant_settings ADD CONSTRAINT tenant_settings_universal_action_config_no_secrets_check CHECK (
  universal_action_config::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
);

ALTER TABLE finnor_os.tasks ADD COLUMN IF NOT EXISTS assigned_party_type text;
ALTER TABLE finnor_os.tasks ADD COLUMN IF NOT EXISTS assigned_party_id uuid;
ALTER TABLE finnor_os.tasks ADD COLUMN IF NOT EXISTS work_id uuid REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.tasks ADD COLUMN IF NOT EXISTS source_domain_action_id uuid REFERENCES finnor_os.domain_actions(id);
ALTER TABLE finnor_os.tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE finnor_os.tasks DROP CONSTRAINT IF EXISTS tasks_assigned_party_type_check;
ALTER TABLE finnor_os.tasks ADD CONSTRAINT tasks_assigned_party_type_check
  CHECK (assigned_party_type IS NULL OR assigned_party_type IN ('employee','team'));
CREATE UNIQUE INDEX IF NOT EXISTS tasks_source_domain_action_unique
  ON finnor_os.tasks(source_domain_action_id) WHERE source_domain_action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_tenant_work_status_idx ON finnor_os.tasks(tenant_id,work_id,status);
CREATE INDEX IF NOT EXISTS tasks_tenant_assigned_party_idx ON finnor_os.tasks(tenant_id,assigned_party_type,assigned_party_id,status);

-- Composite tenant/id keys let every ordinary reference enforce the tenant boundary
-- with a real foreign key, even when the referenced UUID is known to an attacker.
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='domain_actions_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.domain_actions ADD CONSTRAINT domain_actions_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='works_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.works ADD CONSTRAINT works_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tasks ADD CONSTRAINT tasks_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='work_objective_loops_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.work_objective_loops ADD CONSTRAINT work_objective_loops_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='documents_tenant_id_id_key' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.documents ADD CONSTRAINT documents_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_work_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tasks ADD CONSTRAINT tasks_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
      REFERENCES finnor_os.works(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_source_action_tenant_fkey' AND connamespace='finnor_os'::regnamespace) THEN
    ALTER TABLE finnor_os.tasks ADD CONSTRAINT tasks_source_action_tenant_fkey FOREIGN KEY (tenant_id,source_domain_action_id)
      REFERENCES finnor_os.domain_actions(tenant_id,id);
  END IF;
END $constraints$;

CREATE TABLE IF NOT EXISTS finnor_os.communication_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  work_id uuid,
  recipient_type text NOT NULL CHECK (recipient_type IN ('employee','team','location','household','contact','external_organization','external_contact')),
  recipient_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('internal','email','sms','voice')),
  route text NOT NULL CHECK (route IN ('native','api','browser','computer','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','unknown')),
  provider text,
  communication_identity_id uuid,
  provider_message_ref text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_deliveries_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT communication_deliveries_domain_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT communication_deliveries_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
    REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT communication_deliveries_identity_tenant_fkey FOREIGN KEY (tenant_id,communication_identity_id)
    REFERENCES finnor_os.communication_identities(tenant_id,id),
  CONSTRAINT communication_deliveries_semantic_unique UNIQUE (domain_action_id,recipient_type,recipient_id,channel)
);
CREATE INDEX IF NOT EXISTS communication_deliveries_tenant_status_idx
  ON finnor_os.communication_deliveries(tenant_id,status,updated_at);
CREATE INDEX IF NOT EXISTS communication_deliveries_tenant_recipient_idx
  ON finnor_os.communication_deliveries(tenant_id,recipient_type,recipient_id,created_at);

CREATE TABLE IF NOT EXISTS finnor_os.delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  work_id uuid,
  task_id uuid,
  objective_loop_id uuid,
  created_by uuid,
  target_type text NOT NULL CHECK (target_type IN ('employee','team','location','household','contact','external_organization','external_contact')),
  target_id uuid NOT NULL,
  objective text NOT NULL CHECK (btrim(objective)<>'' AND length(objective)<=2000),
  intent jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(intent)='object'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN (
    'created','sent','delivered','acknowledged','accepted','completed','declined','overdue','escalated','cancelled','failed_delivery'
  )),
  acknowledgement_deadline timestamptz,
  completion_deadline timestamptz,
  escalation_target_type text CHECK (escalation_target_type IS NULL OR escalation_target_type IN ('employee','team','location')),
  escalation_target_id uuid,
  escalation_rule jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(escalation_rule)='object'),
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_refs)='array'),
  acknowledged_at timestamptz,
  accepted_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegations_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT delegations_domain_action_unique UNIQUE (domain_action_id),
  CONSTRAINT delegations_domain_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT delegations_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
    REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT delegations_task_tenant_fkey FOREIGN KEY (tenant_id,task_id)
    REFERENCES finnor_os.tasks(tenant_id,id),
  CONSTRAINT delegations_objective_loop_tenant_fkey FOREIGN KEY (tenant_id,objective_loop_id)
    REFERENCES finnor_os.work_objective_loops(tenant_id,id),
  CONSTRAINT delegations_created_by_tenant_fkey FOREIGN KEY (tenant_id,created_by)
    REFERENCES finnor_os.users(tenant_id,id),
  CONSTRAINT delegations_escalation_pair_check CHECK ((escalation_target_type IS NULL)=(escalation_target_id IS NULL)),
  CONSTRAINT delegations_deadline_order_check CHECK (
    acknowledgement_deadline IS NULL OR completion_deadline IS NULL OR acknowledgement_deadline<=completion_deadline
  )
);
CREATE INDEX IF NOT EXISTS delegations_tenant_target_status_idx
  ON finnor_os.delegations(tenant_id,target_type,target_id,status);
CREATE INDEX IF NOT EXISTS delegations_tenant_deadlines_idx
  ON finnor_os.delegations(tenant_id,status,acknowledgement_deadline,completion_deadline);

CREATE TABLE IF NOT EXISTS finnor_os.delegation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  delegation_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq>0),
  event_type text NOT NULL CHECK (btrim(event_type)<>''),
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delegation_events_delegation_seq_unique UNIQUE (delegation_id,seq),
  CONSTRAINT delegation_events_delegation_tenant_fkey FOREIGN KEY (tenant_id,delegation_id)
    REFERENCES finnor_os.delegations(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT delegation_events_actor_tenant_fkey FOREIGN KEY (tenant_id,actor_id)
    REFERENCES finnor_os.users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS delegation_events_tenant_delegation_idx
  ON finnor_os.delegation_events(tenant_id,delegation_id,created_at);

CREATE TABLE IF NOT EXISTS finnor_os.acknowledgement_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  delegation_id uuid,
  delivery_id uuid,
  work_id uuid,
  task_id uuid,
  recipient_type text NOT NULL CHECK (recipient_type IN ('employee','team','location','household','contact','external_organization','external_contact')),
  recipient_id uuid NOT NULL,
  request text NOT NULL CHECK (btrim(request)<>'' AND length(request)<=2000),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','delivered','acknowledged','declined','expired','cancelled')),
  deadline timestamptz,
  acknowledged_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acknowledgement_requests_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT acknowledgement_requests_domain_action_unique UNIQUE (domain_action_id),
  CONSTRAINT acknowledgement_requests_domain_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT acknowledgement_requests_delegation_tenant_fkey FOREIGN KEY (tenant_id,delegation_id)
    REFERENCES finnor_os.delegations(tenant_id,id),
  CONSTRAINT acknowledgement_requests_delivery_tenant_fkey FOREIGN KEY (tenant_id,delivery_id)
    REFERENCES finnor_os.communication_deliveries(tenant_id,id),
  CONSTRAINT acknowledgement_requests_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
    REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT acknowledgement_requests_task_tenant_fkey FOREIGN KEY (tenant_id,task_id)
    REFERENCES finnor_os.tasks(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS acknowledgement_requests_tenant_status_deadline_idx
  ON finnor_os.acknowledgement_requests(tenant_id,status,deadline);

CREATE TABLE IF NOT EXISTS finnor_os.internal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  origin_domain_action_id uuid NOT NULL,
  last_domain_action_id uuid NOT NULL,
  work_id uuid,
  location_id uuid,
  title text NOT NULL CHECK (btrim(title)<>'' AND length(title)<=300),
  purpose text CHECK (purpose IS NULL OR length(purpose)<=2000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','rescheduled','cancelled','completed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_events_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT internal_events_origin_action_unique UNIQUE (origin_domain_action_id),
  CONSTRAINT internal_events_origin_action_tenant_fkey FOREIGN KEY (tenant_id,origin_domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT internal_events_last_action_tenant_fkey FOREIGN KEY (tenant_id,last_domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT internal_events_work_tenant_fkey FOREIGN KEY (tenant_id,work_id)
    REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT internal_events_location_tenant_fkey FOREIGN KEY (tenant_id,location_id)
    REFERENCES finnor_os.tenant_locations(tenant_id,id),
  CONSTRAINT internal_events_created_by_tenant_fkey FOREIGN KEY (tenant_id,created_by)
    REFERENCES finnor_os.users(tenant_id,id),
  CONSTRAINT internal_events_time_order_check CHECK (ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS internal_events_tenant_time_idx ON finnor_os.internal_events(tenant_id,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS finnor_os.internal_event_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  internal_event_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('employee','team','location','household','contact','external_organization','external_contact')),
  party_id uuid NOT NULL,
  response_status text NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending','accepted','declined','tentative')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_event_participants_event_tenant_fkey FOREIGN KEY (tenant_id,internal_event_id)
    REFERENCES finnor_os.internal_events(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT internal_event_participants_identity_unique UNIQUE (internal_event_id,party_type,party_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.internal_event_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  internal_event_id uuid NOT NULL,
  domain_action_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq>0),
  event_type text NOT NULL CHECK (btrim(event_type)<>''),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_event_events_event_tenant_fkey FOREIGN KEY (tenant_id,internal_event_id)
    REFERENCES finnor_os.internal_events(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT internal_event_events_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT internal_event_events_event_seq_unique UNIQUE (internal_event_id,seq),
  CONSTRAINT internal_event_events_domain_action_unique UNIQUE (domain_action_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  document_id uuid NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('employee','team','location','household','contact','external_organization','external_contact')),
  recipient_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'view' CHECK (access_level IN ('view','comment')),
  route text NOT NULL CHECK (route IN ('native','api','browser','computer','manual')),
  status text NOT NULL CHECK (status IN ('shared','pending_manual','failed','revoked')),
  provider_share_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_shares_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT document_shares_domain_action_unique UNIQUE (domain_action_id),
  CONSTRAINT document_shares_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT document_shares_document_tenant_fkey FOREIGN KEY (tenant_id,document_id)
    REFERENCES finnor_os.documents(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS document_shares_tenant_document_idx ON finnor_os.document_shares(tenant_id,document_id,created_at);

CREATE TABLE IF NOT EXISTS finnor_os.universal_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq>0),
  action_type text NOT NULL,
  event_type text NOT NULL,
  route text CHECK (route IS NULL OR route IN ('native','api','browser','computer','manual')),
  subject_type text,
  subject_id uuid,
  actor_id uuid,
  communication_identity_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT universal_action_events_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT universal_action_events_actor_tenant_fkey FOREIGN KEY (tenant_id,actor_id)
    REFERENCES finnor_os.users(tenant_id,id),
  CONSTRAINT universal_action_events_identity_tenant_fkey FOREIGN KEY (tenant_id,communication_identity_id)
    REFERENCES finnor_os.communication_identities(tenant_id,id),
  CONSTRAINT universal_action_events_action_seq_unique UNIQUE (domain_action_id,seq),
  CONSTRAINT universal_action_events_subject_pair_check CHECK ((subject_type IS NULL)=(subject_id IS NULL))
);
CREATE INDEX IF NOT EXISTS universal_action_events_tenant_action_idx
  ON finnor_os.universal_action_events(tenant_id,domain_action_id,created_at);

-- Polymorphic PartyRefs are validated at the database boundary. This function sees
-- only canonical rows and never returns endpoint or credential data.
CREATE OR REPLACE FUNCTION finnor_os.party_ref_tenant(p_type text,p_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved uuid;
BEGIN
  CASE p_type
    WHEN 'employee' THEN SELECT tenant_id INTO resolved FROM finnor_os.users WHERE id=p_id;
    WHEN 'team' THEN SELECT tenant_id INTO resolved FROM finnor_os.org_units WHERE id=p_id;
    WHEN 'location' THEN SELECT tenant_id INTO resolved FROM finnor_os.tenant_locations WHERE id=p_id;
    WHEN 'household' THEN SELECT tenant_id INTO resolved FROM finnor_os.households WHERE id=p_id;
    WHEN 'contact' THEN SELECT tenant_id INTO resolved FROM finnor_os.contacts WHERE id=p_id;
    WHEN 'external_organization' THEN SELECT tenant_id INTO resolved FROM finnor_os.external_organizations WHERE id=p_id;
    WHEN 'external_contact' THEN SELECT tenant_id INTO resolved FROM finnor_os.external_contacts WHERE id=p_id;
    ELSE RAISE EXCEPTION 'unsupported PartyRef type: %',p_type;
  END CASE;
  RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION finnor_os.party_ref_tenant(text,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.assert_party_ref_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE pair_start integer; type_value text; id_value uuid; resolved uuid; row_data jsonb;
BEGIN
  row_data := to_jsonb(NEW);
  pair_start := 0;
  WHILE pair_start < TG_NARGS LOOP
    type_value := row_data->>TG_ARGV[pair_start];
    id_value := nullif(row_data->>TG_ARGV[pair_start+1],'')::uuid;
    IF type_value IS NULL AND id_value IS NULL THEN
      pair_start := pair_start+2;
      CONTINUE;
    END IF;
    IF type_value IS NULL OR id_value IS NULL THEN RAISE EXCEPTION 'PartyRef type/id must be supplied together'; END IF;
    resolved := finnor_os.party_ref_tenant(type_value,id_value);
    IF resolved IS NULL OR resolved IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'PartyRef crosses tenant boundary or does not exist';
    END IF;
    pair_start := pair_start+2;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.assert_party_ref_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS communication_deliveries_party_scope ON finnor_os.communication_deliveries;
CREATE TRIGGER communication_deliveries_party_scope BEFORE INSERT OR UPDATE ON finnor_os.communication_deliveries
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_ref_scope('recipient_type','recipient_id');
DROP TRIGGER IF EXISTS delegations_party_scope ON finnor_os.delegations;
CREATE TRIGGER delegations_party_scope BEFORE INSERT OR UPDATE ON finnor_os.delegations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_ref_scope('target_type','target_id','escalation_target_type','escalation_target_id');
DROP TRIGGER IF EXISTS acknowledgement_requests_party_scope ON finnor_os.acknowledgement_requests;
CREATE TRIGGER acknowledgement_requests_party_scope BEFORE INSERT OR UPDATE ON finnor_os.acknowledgement_requests
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_ref_scope('recipient_type','recipient_id');
DROP TRIGGER IF EXISTS internal_event_participants_party_scope ON finnor_os.internal_event_participants;
CREATE TRIGGER internal_event_participants_party_scope BEFORE INSERT OR UPDATE ON finnor_os.internal_event_participants
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_ref_scope('party_type','party_id');
DROP TRIGGER IF EXISTS document_shares_party_scope ON finnor_os.document_shares;
CREATE TRIGGER document_shares_party_scope BEFORE INSERT OR UPDATE ON finnor_os.document_shares
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_ref_scope('recipient_type','recipient_id');
DROP TRIGGER IF EXISTS tasks_assigned_party_scope ON finnor_os.tasks;
CREATE TRIGGER tasks_assigned_party_scope BEFORE INSERT OR UPDATE ON finnor_os.tasks
  FOR EACH ROW WHEN (NEW.assigned_party_type IS NOT NULL OR NEW.assigned_party_id IS NOT NULL)
  EXECUTE FUNCTION finnor_os.assert_party_ref_scope('assigned_party_type','assigned_party_id');

-- Extend canonical entity validation without changing any original entity mapping.
CREATE OR REPLACE FUNCTION finnor_os.canonical_entity_tenant(p_type text,p_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved uuid;
BEGIN
  CASE p_type
    WHEN 'household' THEN SELECT tenant_id INTO resolved FROM finnor_os.households WHERE id=p_id;
    WHEN 'contact' THEN SELECT tenant_id INTO resolved FROM finnor_os.contacts WHERE id=p_id;
    WHEN 'user' THEN SELECT tenant_id INTO resolved FROM finnor_os.users WHERE id=p_id;
    WHEN 'org_unit' THEN SELECT tenant_id INTO resolved FROM finnor_os.org_units WHERE id=p_id;
    WHEN 'tenant_location' THEN SELECT tenant_id INTO resolved FROM finnor_os.tenant_locations WHERE id=p_id;
    WHEN 'external_organization' THEN SELECT tenant_id INTO resolved FROM finnor_os.external_organizations WHERE id=p_id;
    WHEN 'external_contact' THEN SELECT tenant_id INTO resolved FROM finnor_os.external_contacts WHERE id=p_id;
    WHEN 'technician' THEN SELECT tenant_id INTO resolved FROM finnor_os.technicians WHERE id=p_id;
    WHEN 'equipment' THEN SELECT tenant_id INTO resolved FROM finnor_os.equipment WHERE id=p_id;
    WHEN 'service_visit' THEN SELECT tenant_id INTO resolved FROM finnor_os.service_visits WHERE id=p_id;
    WHEN 'maintenance_agreement' THEN SELECT tenant_id INTO resolved FROM finnor_os.maintenance_agreements WHERE id=p_id;
    WHEN 'lead' THEN SELECT tenant_id INTO resolved FROM finnor_os.leads WHERE id=p_id;
    WHEN 'opportunity' THEN SELECT tenant_id INTO resolved FROM finnor_os.opportunities WHERE id=p_id;
    WHEN 'quote' THEN SELECT tenant_id INTO resolved FROM finnor_os.quotes WHERE id=p_id;
    WHEN 'proposal' THEN SELECT tenant_id INTO resolved FROM finnor_os.proposals WHERE id=p_id;
    WHEN 'work_order' THEN SELECT tenant_id INTO resolved FROM finnor_os.work_orders WHERE id=p_id;
    WHEN 'appointment' THEN SELECT tenant_id INTO resolved FROM finnor_os.appointments WHERE id=p_id;
    WHEN 'invoice' THEN SELECT tenant_id INTO resolved FROM finnor_os.invoices WHERE id=p_id;
    WHEN 'payment' THEN SELECT tenant_id INTO resolved FROM finnor_os.payments WHERE id=p_id;
    WHEN 'conversation' THEN SELECT tenant_id INTO resolved FROM finnor_os.conversations WHERE id=p_id;
    WHEN 'call' THEN SELECT tenant_id INTO resolved FROM finnor_os.calls WHERE id=p_id;
    WHEN 'message' THEN SELECT tenant_id INTO resolved FROM finnor_os.messages WHERE id=p_id;
    WHEN 'communication' THEN SELECT tenant_id INTO resolved FROM finnor_os.communications_log WHERE id=p_id;
    WHEN 'document' THEN SELECT tenant_id INTO resolved FROM finnor_os.documents WHERE id=p_id;
    WHEN 'task' THEN SELECT tenant_id INTO resolved FROM finnor_os.tasks WHERE id=p_id;
    WHEN 'work' THEN SELECT tenant_id INTO resolved FROM finnor_os.works WHERE id=p_id;
    WHEN 'domain_action' THEN SELECT tenant_id INTO resolved FROM finnor_os.domain_actions WHERE id=p_id;
    WHEN 'workflow_run' THEN SELECT tenant_id INTO resolved FROM finnor_os.workflow_runs WHERE id=p_id;
    WHEN 'workflow_step' THEN SELECT tenant_id INTO resolved FROM finnor_os.workflow_steps WHERE id=p_id;
    WHEN 'business_operation' THEN SELECT tenant_id INTO resolved FROM finnor_os.business_operations WHERE id=p_id;
    WHEN 'business_operation_target' THEN SELECT tenant_id INTO resolved FROM finnor_os.business_operation_targets WHERE id=p_id;
    WHEN 'decision_receipt' THEN SELECT tenant_id INTO resolved FROM finnor_os.decision_receipts WHERE id=p_id;
    WHEN 'business_event' THEN SELECT tenant_id INTO resolved FROM finnor_os.business_events WHERE id=p_id;
    WHEN 'delegation' THEN SELECT tenant_id INTO resolved FROM finnor_os.delegations WHERE id=p_id;
    WHEN 'acknowledgement_request' THEN SELECT tenant_id INTO resolved FROM finnor_os.acknowledgement_requests WHERE id=p_id;
    WHEN 'communication_delivery' THEN SELECT tenant_id INTO resolved FROM finnor_os.communication_deliveries WHERE id=p_id;
    WHEN 'internal_event' THEN SELECT tenant_id INTO resolved FROM finnor_os.internal_events WHERE id=p_id;
    WHEN 'document_share' THEN SELECT tenant_id INTO resolved FROM finnor_os.document_shares WHERE id=p_id;
    ELSE RAISE EXCEPTION 'unsupported canonical entity type: %',p_type;
  END CASE;
  RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.assert_p2_task_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved uuid;
BEGIN
  IF NEW.source_domain_action_id IS NOT NULL THEN
    resolved := finnor_os.canonical_entity_tenant(NEW.subject_type,NEW.subject_id);
    IF resolved IS NULL OR resolved IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'P2 task subject crosses tenant boundary or is not canonical';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.assert_p2_task_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS tasks_p2_subject_scope ON finnor_os.tasks;
CREATE TRIGGER tasks_p2_subject_scope BEFORE INSERT OR UPDATE ON finnor_os.tasks
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_p2_task_scope();

CREATE OR REPLACE FUNCTION finnor_os.prevent_append_only_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only',TG_TABLE_NAME; END $$;
REVOKE ALL ON FUNCTION finnor_os.prevent_append_only_mutation() FROM PUBLIC;
DROP TRIGGER IF EXISTS delegation_events_append_only ON finnor_os.delegation_events;
CREATE TRIGGER delegation_events_append_only BEFORE UPDATE OR DELETE ON finnor_os.delegation_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.prevent_append_only_mutation();
DROP TRIGGER IF EXISTS internal_event_events_append_only ON finnor_os.internal_event_events;
CREATE TRIGGER internal_event_events_append_only BEFORE UPDATE OR DELETE ON finnor_os.internal_event_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.prevent_append_only_mutation();
DROP TRIGGER IF EXISTS universal_action_events_append_only ON finnor_os.universal_action_events;
CREATE TRIGGER universal_action_events_append_only BEFORE UPDATE OR DELETE ON finnor_os.universal_action_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.prevent_append_only_mutation();

-- A timed-out consequential request has an unknown provider outcome. It cannot be
-- automatically reclaimed like a known failure; explicit reconciliation must settle it.
ALTER TABLE finnor_os.external_operations DROP CONSTRAINT IF EXISTS external_operations_status_check;
ALTER TABLE finnor_os.external_operations ADD CONSTRAINT external_operations_status_check
  CHECK (status IN ('running','succeeded','failed','unknown'));
ALTER TABLE finnor_os.dead_letters DROP CONSTRAINT IF EXISTS dead_letters_error_kind_check;
ALTER TABLE finnor_os.dead_letters ADD CONSTRAINT dead_letters_error_kind_check CHECK (
  error_kind IN ('retryable','terminal','conflict','auth','validation','provider_down','needs_human','config','unknown_outcome')
);
ALTER TABLE finnor_os.business_operation_targets DROP CONSTRAINT IF EXISTS business_operation_targets_error_kind_check;
ALTER TABLE finnor_os.business_operation_targets ADD CONSTRAINT business_operation_targets_error_kind_check CHECK (
  error_kind IS NULL OR error_kind IN ('retryable','terminal','conflict','auth','validation','provider_down','needs_human','config','unknown_outcome')
);

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communication_deliveries','delegations','delegation_events','acknowledgement_requests',
    'internal_events','internal_event_participants','internal_event_events','document_shares','universal_action_events'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON
      finnor_os.communication_deliveries,
      finnor_os.delegations,
      finnor_os.acknowledgement_requests,
      finnor_os.internal_events,
      finnor_os.internal_event_participants,
      finnor_os.document_shares TO finnor_app;
    GRANT SELECT,INSERT ON
      finnor_os.delegation_events,
      finnor_os.internal_event_events,
      finnor_os.universal_action_events TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.party_ref_tenant(text,uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_party_ref_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_p2_task_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.prevent_append_only_mutation() TO finnor_app;
  END IF;
END $rls$;
