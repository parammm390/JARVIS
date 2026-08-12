-- Upgrade 7: canonical company graph.
--
-- Canonical business rows stay in their existing tables. This migration adds a
-- tenant-safe Work attachment (the one relationship without a real FK home),
-- gives legacy household children direct tenant identity, and exposes typed
-- foreign-key truth as a security-invoker view. No entity data is copied.

ALTER TABLE finnor_os.work_query_executions DROP CONSTRAINT IF EXISTS work_query_executions_intent_check;
ALTER TABLE finnor_os.work_query_executions ADD CONSTRAINT work_query_executions_intent_check CHECK (intent IN (
  'customer_lookup','customer_cohort','schedule_range','money_summary','work_list',
  'inventory_status','agent_activity','business_state','company_context'
));

ALTER TABLE finnor_os.equipment ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE finnor_os.service_visits ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE finnor_os.maintenance_agreements ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE finnor_os.proposals ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE finnor_os.communications_log ADD COLUMN IF NOT EXISTS tenant_id uuid;

UPDATE finnor_os.equipment c SET tenant_id = h.tenant_id
FROM finnor_os.households h WHERE h.id = c.household_id AND c.tenant_id IS DISTINCT FROM h.tenant_id;
UPDATE finnor_os.service_visits c SET tenant_id = h.tenant_id
FROM finnor_os.households h WHERE h.id = c.household_id AND c.tenant_id IS DISTINCT FROM h.tenant_id;
UPDATE finnor_os.maintenance_agreements c SET tenant_id = h.tenant_id
FROM finnor_os.households h WHERE h.id = c.household_id AND c.tenant_id IS DISTINCT FROM h.tenant_id;
UPDATE finnor_os.proposals c SET tenant_id = h.tenant_id
FROM finnor_os.households h WHERE h.id = c.household_id AND c.tenant_id IS DISTINCT FROM h.tenant_id;
UPDATE finnor_os.communications_log c SET tenant_id = h.tenant_id
FROM finnor_os.households h WHERE h.id = c.household_id AND c.tenant_id IS DISTINCT FROM h.tenant_id;

ALTER TABLE finnor_os.equipment ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE finnor_os.service_visits ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE finnor_os.maintenance_agreements ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE finnor_os.proposals ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE finnor_os.communications_log ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE finnor_os.equipment ALTER COLUMN tenant_id SET DEFAULT finnor_os.request_tenant_id();
ALTER TABLE finnor_os.service_visits ALTER COLUMN tenant_id SET DEFAULT finnor_os.request_tenant_id();
ALTER TABLE finnor_os.maintenance_agreements ALTER COLUMN tenant_id SET DEFAULT finnor_os.request_tenant_id();
ALTER TABLE finnor_os.proposals ALTER COLUMN tenant_id SET DEFAULT finnor_os.request_tenant_id();
ALTER TABLE finnor_os.communications_log ALTER COLUMN tenant_id SET DEFAULT finnor_os.request_tenant_id();

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_tenant_id_fkey' AND conrelid = 'finnor_os.equipment'::regclass) THEN
    ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES finnor_os.tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'service_visits_tenant_id_fkey' AND conrelid = 'finnor_os.service_visits'::regclass) THEN
    ALTER TABLE finnor_os.service_visits ADD CONSTRAINT service_visits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES finnor_os.tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_agreements_tenant_id_fkey' AND conrelid = 'finnor_os.maintenance_agreements'::regclass) THEN
    ALTER TABLE finnor_os.maintenance_agreements ADD CONSTRAINT maintenance_agreements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES finnor_os.tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'proposals_tenant_id_fkey' AND conrelid = 'finnor_os.proposals'::regclass) THEN
    ALTER TABLE finnor_os.proposals ADD CONSTRAINT proposals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES finnor_os.tenants(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_log_tenant_id_fkey' AND conrelid = 'finnor_os.communications_log'::regclass) THEN
    ALTER TABLE finnor_os.communications_log ADD CONSTRAINT communications_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES finnor_os.tenants(id);
  END IF;
END $constraints$;

CREATE INDEX IF NOT EXISTS equipment_tenant_household_idx ON finnor_os.equipment(tenant_id, household_id, id);
CREATE INDEX IF NOT EXISTS service_visits_tenant_household_time_idx ON finnor_os.service_visits(tenant_id, household_id, scheduled_at, id);
CREATE INDEX IF NOT EXISTS maintenance_agreements_tenant_household_idx ON finnor_os.maintenance_agreements(tenant_id, household_id, id);
CREATE INDEX IF NOT EXISTS proposals_tenant_household_idx ON finnor_os.proposals(tenant_id, household_id, id);
CREATE INDEX IF NOT EXISTS communications_log_tenant_household_time_idx ON finnor_os.communications_log(tenant_id, household_id, timestamp DESC, id);

CREATE OR REPLACE FUNCTION finnor_os.assert_household_child_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE household_tenant uuid;
BEGIN
  SELECT tenant_id INTO household_tenant FROM finnor_os.households WHERE id = NEW.household_id;
  IF household_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'household child does not belong to tenant';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_household_child_scope() FROM PUBLIC;

DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['equipment','service_visits','maintenance_agreements','proposals','communications_log'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finnor_os.%I', table_name || '_scope', table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF tenant_id, household_id ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_household_child_scope()', table_name || '_scope', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I', table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id())', table_name);
  END LOOP;
END $triggers$;

CREATE OR REPLACE FUNCTION finnor_os.canonical_entity_tenant(p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE resolved uuid;
BEGIN
  CASE p_type
    WHEN 'household' THEN SELECT tenant_id INTO resolved FROM finnor_os.households WHERE id=p_id;
    WHEN 'contact' THEN SELECT tenant_id INTO resolved FROM finnor_os.contacts WHERE id=p_id;
    WHEN 'user' THEN SELECT tenant_id INTO resolved FROM finnor_os.users WHERE id=p_id;
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
    ELSE RAISE EXCEPTION 'unsupported canonical entity type: %', p_type;
  END CASE;
  RETURN resolved;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.assert_canonical_ref_tenant(p_type text, p_id uuid, p_tenant uuid, p_label text) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_id IS NOT NULL AND finnor_os.canonical_entity_tenant(p_type, p_id) IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION '% canonical reference crosses tenant boundary or is missing', p_label;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_canonical_ref_tenant(text, uuid, uuid, text) FROM PUBLIC;

-- Existing simple FKs prove row existence but not tenant equality. This single
-- trigger function closes that gap for every edge exposed by the graph contract.
CREATE OR REPLACE FUNCTION finnor_os.assert_company_relationship_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_tenant uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'users' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('technician', NEW.technician_id, NEW.tenant_id, 'user.technician');
    WHEN 'contacts' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'contact.household');
    WHEN 'service_visits' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('technician', NEW.technician_id, NEW.tenant_id, 'service_visit.technician');
    WHEN 'proposals' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('quote', NEW.quote_id, NEW.tenant_id, 'proposal.quote');
    WHEN 'leads' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'lead.household');
      IF NEW.contact_method_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.contact_methods WHERE id=NEW.contact_method_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'lead.contact_method canonical reference crosses tenant boundary or is missing'; END IF;
      END IF;
    WHEN 'opportunities' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('lead', NEW.lead_id, NEW.tenant_id, 'opportunity.lead');
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'opportunity.household');
    WHEN 'quotes' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'quote.household');
      PERFORM finnor_os.assert_canonical_ref_tenant('lead', NEW.lead_id, NEW.tenant_id, 'quote.lead');
      PERFORM finnor_os.assert_canonical_ref_tenant('opportunity', NEW.opportunity_id, NEW.tenant_id, 'quote.opportunity');
    WHEN 'work_orders' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'work_order.household');
      PERFORM finnor_os.assert_canonical_ref_tenant('quote', NEW.quote_id, NEW.tenant_id, 'work_order.quote');
      PERFORM finnor_os.assert_canonical_ref_tenant('technician', NEW.technician_id, NEW.tenant_id, 'work_order.technician');
    WHEN 'appointments' THEN
      IF NEW.subject_type IN ('household','lead','work_order') THEN
        PERFORM finnor_os.assert_canonical_ref_tenant(NEW.subject_type, NEW.subject_id, NEW.tenant_id, 'appointment.subject');
      END IF;
      PERFORM finnor_os.assert_canonical_ref_tenant('technician', NEW.technician_id, NEW.tenant_id, 'appointment.technician');
    WHEN 'invoices' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'invoice.household');
    WHEN 'payments' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('invoice', NEW.invoice_id, NEW.tenant_id, 'payment.invoice');
    WHEN 'conversations' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'conversation.household');
      PERFORM finnor_os.assert_canonical_ref_tenant('contact', NEW.contact_id, NEW.tenant_id, 'conversation.contact');
    WHEN 'calls' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('conversation', NEW.conversation_id, NEW.tenant_id, 'call.conversation');
    WHEN 'messages' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('conversation', NEW.conversation_id, NEW.tenant_id, 'message.conversation');
    WHEN 'documents' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('household', NEW.household_id, NEW.tenant_id, 'document.household');
    WHEN 'tasks' THEN
      IF NEW.subject_type IN ('household','lead','opportunity','quote','work_order','invoice','appointment') THEN
        PERFORM finnor_os.assert_canonical_ref_tenant(NEW.subject_type, NEW.subject_id, NEW.tenant_id, 'task.subject');
      END IF;
      IF NEW.assignee_type IN ('user','technician') THEN
        PERFORM finnor_os.assert_canonical_ref_tenant(NEW.assignee_type, NEW.assignee_id, NEW.tenant_id, 'task.assignee');
      END IF;
    WHEN 'domain_actions' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('work', NEW.work_id, NEW.tenant_id, 'domain_action.work');
      IF NEW.planner_attempt_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.work_planner_attempts WHERE id=NEW.planner_attempt_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'domain_action.planner_attempt canonical reference crosses tenant boundary or is missing'; END IF;
      END IF;
    WHEN 'workflow_runs' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('work', NEW.work_id, NEW.tenant_id, 'workflow_run.work');
      SELECT tenant_id INTO related_tenant FROM finnor_os.commands WHERE id=NEW.command_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'workflow_run.command canonical reference crosses tenant boundary or is missing'; END IF;
    WHEN 'workflow_steps' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('workflow_run', NEW.workflow_run_id, NEW.tenant_id, 'workflow_step.run');
      PERFORM finnor_os.assert_canonical_ref_tenant('domain_action', NEW.domain_action_id, NEW.tenant_id, 'workflow_step.action');
    WHEN 'decision_receipts' THEN
      PERFORM finnor_os.assert_canonical_ref_tenant('work', NEW.work_id, NEW.tenant_id, 'decision_receipt.work');
      PERFORM finnor_os.assert_canonical_ref_tenant('domain_action', NEW.domain_action_id, NEW.tenant_id, 'decision_receipt.action');
      PERFORM finnor_os.assert_canonical_ref_tenant('workflow_run', NEW.workflow_run_id, NEW.tenant_id, 'decision_receipt.run');
      PERFORM finnor_os.assert_canonical_ref_tenant('workflow_step', NEW.workflow_step_id, NEW.tenant_id, 'decision_receipt.step');
      PERFORM finnor_os.assert_canonical_ref_tenant('business_operation', NEW.operation_id, NEW.tenant_id, 'decision_receipt.operation');
  END CASE;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_company_relationship_scope() FROM PUBLIC;

DO $relationship_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users','contacts','service_visits','proposals','leads','opportunities','quotes','work_orders',
    'appointments','invoices','payments','conversations','calls','messages','documents','tasks',
    'domain_actions','workflow_runs','workflow_steps','decision_receipts'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS company_relationship_scope ON finnor_os.%I', table_name);
    EXECUTE format('CREATE TRIGGER company_relationship_scope BEFORE INSERT OR UPDATE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_company_relationship_scope()', table_name);
  END LOOP;
END $relationship_triggers$;

CREATE TABLE IF NOT EXISTS finnor_os.work_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  entity_type text NOT NULL CHECK (entity_type IN (
    'household','contact','user','technician','equipment','service_visit','maintenance_agreement',
    'lead','opportunity','quote','proposal','work_order','appointment','invoice','payment',
    'conversation','call','message','communication','document','task','domain_action','workflow_run','workflow_step',
    'business_operation','business_operation_target','decision_receipt','business_event'
  )),
  entity_id uuid NOT NULL,
  relationship text NOT NULL DEFAULT 'about' CHECK (relationship IN ('about','target','result')),
  source text NOT NULL DEFAULT 'runtime',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(work_id, entity_type, entity_id, relationship)
);
CREATE INDEX IF NOT EXISTS work_entity_links_tenant_work_idx ON finnor_os.work_entity_links(tenant_id, work_id);
CREATE INDEX IF NOT EXISTS work_entity_links_tenant_entity_idx ON finnor_os.work_entity_links(tenant_id, entity_type, entity_id);

CREATE OR REPLACE FUNCTION finnor_os.assert_work_entity_link_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE work_tenant uuid; entity_tenant uuid;
BEGIN
  SELECT tenant_id INTO work_tenant FROM finnor_os.works WHERE id=NEW.work_id;
  entity_tenant := finnor_os.canonical_entity_tenant(NEW.entity_type, NEW.entity_id);
  IF work_tenant IS NULL OR entity_tenant IS NULL THEN RAISE EXCEPTION 'canonical Work link references an unknown entity'; END IF;
  IF work_tenant IS DISTINCT FROM NEW.tenant_id OR entity_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'canonical Work link crosses tenant boundary';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_work_entity_link_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS work_entity_links_scope ON finnor_os.work_entity_links;
CREATE TRIGGER work_entity_links_scope BEFORE INSERT OR UPDATE ON finnor_os.work_entity_links
FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_work_entity_link_scope();

ALTER TABLE finnor_os.work_entity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.work_entity_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.work_entity_links;
CREATE POLICY tenant_isolation ON finnor_os.work_entity_links
USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id());

CREATE OR REPLACE VIEW finnor_os.company_graph_edges WITH (security_invoker=true) AS
SELECT edge.* FROM (
  SELECT tenant_id, 'contact'::text from_entity_type, id from_entity_id, 'member_of'::text relationship, 'household'::text to_entity_type, household_id to_entity_id, 'contacts'::text source_table, 'household_id'::text source_column FROM finnor_os.contacts WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'user',id,'represents','technician',technician_id,'users','technician_id' FROM finnor_os.users WHERE technician_id IS NOT NULL
UNION ALL SELECT tenant_id,'equipment',id,'installed_at','household',household_id,'equipment','household_id' FROM finnor_os.equipment
UNION ALL SELECT tenant_id,'service_visit',id,'service_for','household',household_id,'service_visits','household_id' FROM finnor_os.service_visits
UNION ALL SELECT tenant_id,'service_visit',id,'performed_by','technician',technician_id,'service_visits','technician_id' FROM finnor_os.service_visits WHERE technician_id IS NOT NULL
UNION ALL SELECT tenant_id,'maintenance_agreement',id,'covers','household',household_id,'maintenance_agreements','household_id' FROM finnor_os.maintenance_agreements
UNION ALL SELECT tenant_id,'lead',id,'for_customer','household',household_id,'leads','household_id' FROM finnor_os.leads WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'opportunity',id,'for_customer','household',household_id,'opportunities','household_id' FROM finnor_os.opportunities WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'opportunity',id,'from_lead','lead',lead_id,'opportunities','lead_id' FROM finnor_os.opportunities WHERE lead_id IS NOT NULL
UNION ALL SELECT tenant_id,'quote',id,'for_customer','household',household_id,'quotes','household_id' FROM finnor_os.quotes WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'quote',id,'for_lead','lead',lead_id,'quotes','lead_id' FROM finnor_os.quotes WHERE lead_id IS NOT NULL
UNION ALL SELECT tenant_id,'quote',id,'for_opportunity','opportunity',opportunity_id,'quotes','opportunity_id' FROM finnor_os.quotes WHERE opportunity_id IS NOT NULL
UNION ALL SELECT tenant_id,'proposal',id,'proposed_to','household',household_id,'proposals','household_id' FROM finnor_os.proposals
UNION ALL SELECT tenant_id,'proposal',id,'from_quote','quote',quote_id,'proposals','quote_id' FROM finnor_os.proposals WHERE quote_id IS NOT NULL
UNION ALL SELECT tenant_id,'work_order',id,'service_for','household',household_id,'work_orders','household_id' FROM finnor_os.work_orders
UNION ALL SELECT tenant_id,'work_order',id,'assigned_to','technician',technician_id,'work_orders','technician_id' FROM finnor_os.work_orders WHERE technician_id IS NOT NULL
UNION ALL SELECT tenant_id,'appointment',id,'scheduled_for',subject_type,subject_id,'appointments','subject_id' FROM finnor_os.appointments WHERE subject_type IN ('household','lead','work_order')
UNION ALL SELECT tenant_id,'appointment',id,'assigned_to','technician',technician_id,'appointments','technician_id' FROM finnor_os.appointments WHERE technician_id IS NOT NULL
UNION ALL SELECT tenant_id,'invoice',id,'billed_to','household',household_id,'invoices','household_id' FROM finnor_os.invoices
UNION ALL SELECT tenant_id,'payment',id,'pays','invoice',invoice_id,'payments','invoice_id' FROM finnor_os.payments
UNION ALL SELECT tenant_id,'conversation',id,'with_customer','household',household_id,'conversations','household_id' FROM finnor_os.conversations WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'conversation',id,'with_contact','contact',contact_id,'conversations','contact_id' FROM finnor_os.conversations WHERE contact_id IS NOT NULL
UNION ALL SELECT tenant_id,'call',id,'part_of','conversation',conversation_id,'calls','conversation_id' FROM finnor_os.calls WHERE conversation_id IS NOT NULL
UNION ALL SELECT tenant_id,'message',id,'part_of','conversation',conversation_id,'messages','conversation_id' FROM finnor_os.messages WHERE conversation_id IS NOT NULL
UNION ALL SELECT tenant_id,'communication',id,'with_customer','household',household_id,'communications_log','household_id' FROM finnor_os.communications_log
UNION ALL SELECT tenant_id,'document',id,'about_customer','household',household_id,'documents','household_id' FROM finnor_os.documents WHERE household_id IS NOT NULL
UNION ALL SELECT tenant_id,'task',id,'about',subject_type,subject_id,'tasks','subject_id' FROM finnor_os.tasks WHERE subject_type IN ('household','lead','opportunity','quote','work_order','invoice','appointment')
UNION ALL SELECT tenant_id,'work',work_id,relationship,entity_type,entity_id,'work_entity_links','entity_id' FROM finnor_os.work_entity_links
UNION ALL SELECT tenant_id,'domain_action',id,'part_of','work',work_id,'domain_actions','work_id' FROM finnor_os.domain_actions WHERE work_id IS NOT NULL
UNION ALL SELECT tenant_id,'workflow_run',id,'part_of','work',work_id,'workflow_runs','work_id' FROM finnor_os.workflow_runs WHERE work_id IS NOT NULL
UNION ALL SELECT tenant_id,'workflow_step',id,'part_of','workflow_run',workflow_run_id,'workflow_steps','workflow_run_id' FROM finnor_os.workflow_steps
UNION ALL SELECT tenant_id,'workflow_step',id,'executes','domain_action',domain_action_id,'workflow_steps','domain_action_id' FROM finnor_os.workflow_steps WHERE domain_action_id IS NOT NULL
UNION ALL SELECT tenant_id,'business_operation',id,'part_of','work',work_id,'business_operations','work_id' FROM finnor_os.business_operations WHERE work_id IS NOT NULL
UNION ALL SELECT tenant_id,'business_operation',id,'authorized_by','domain_action',domain_action_id,'business_operations','domain_action_id' FROM finnor_os.business_operations
UNION ALL SELECT tenant_id,'business_operation_target',id,'part_of','business_operation',operation_id,'business_operation_targets','operation_id' FROM finnor_os.business_operation_targets
UNION ALL SELECT tenant_id,'business_operation_target',id,'targets','household',target_id,'business_operation_targets','target_id' FROM finnor_os.business_operation_targets
UNION ALL SELECT tenant_id,'decision_receipt',id,'receipts','work',work_id,'decision_receipts','work_id' FROM finnor_os.decision_receipts WHERE work_id IS NOT NULL
UNION ALL SELECT tenant_id,'decision_receipt',id,'receipts','domain_action',domain_action_id,'decision_receipts','domain_action_id' FROM finnor_os.decision_receipts WHERE domain_action_id IS NOT NULL
UNION ALL SELECT tenant_id,'decision_receipt',id,'receipts','workflow_run',workflow_run_id,'decision_receipts','workflow_run_id' FROM finnor_os.decision_receipts WHERE workflow_run_id IS NOT NULL
UNION ALL SELECT tenant_id,'decision_receipt',id,'receipts','workflow_step',workflow_step_id,'decision_receipts','workflow_step_id' FROM finnor_os.decision_receipts WHERE workflow_step_id IS NOT NULL
UNION ALL SELECT tenant_id,'decision_receipt',id,'receipts','business_operation',operation_id,'decision_receipts','operation_id' FROM finnor_os.decision_receipts WHERE operation_id IS NOT NULL
UNION ALL SELECT tenant_id,'business_event',id,'records',entity_type,entity_id,'business_events','entity_id' FROM finnor_os.business_events
  WHERE entity_type IN ('household','contact','user','technician','equipment','service_visit','maintenance_agreement','lead','opportunity','quote','proposal','work_order','appointment','invoice','payment','conversation','call','message','communication','document','task','work','domain_action','workflow_run','workflow_step','business_operation','business_operation_target','decision_receipt')
) edge
WHERE finnor_os.canonical_entity_tenant(edge.from_entity_type, edge.from_entity_id) = edge.tenant_id
  AND finnor_os.canonical_entity_tenant(edge.to_entity_type, edge.to_entity_id) = edge.tenant_id;

-- Strengthen the existing operation target trigger: the operation and its real
-- household target must both belong to the row tenant.
CREATE OR REPLACE FUNCTION finnor_os.assert_business_operation_child_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE operation_tenant uuid; target_tenant uuid;
BEGIN
  SELECT tenant_id INTO operation_tenant FROM finnor_os.business_operations WHERE id=NEW.operation_id;
  IF operation_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'business operation child does not belong to tenant'; END IF;
  IF TG_TABLE_NAME = 'business_operation_targets' THEN
    SELECT tenant_id INTO target_tenant FROM finnor_os.households WHERE id=NEW.target_id;
    IF target_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'business operation target crosses tenant boundary'; END IF;
  END IF;
  RETURN NEW;
END $$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.work_entity_links TO finnor_app;
    REVOKE DELETE ON finnor_os.work_entity_links FROM finnor_app;
    GRANT SELECT ON finnor_os.company_graph_edges TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_canonical_ref_tenant(text,uuid,uuid,text) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_company_relationship_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_work_entity_link_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_household_child_scope() TO finnor_app;
  END IF;
END $grants$;
