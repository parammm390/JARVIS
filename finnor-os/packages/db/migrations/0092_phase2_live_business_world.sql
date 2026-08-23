-- Phase 2: FINNOR Live Business World + durable tenant-wide realtime.
--
-- Canonical business rows stay in their existing tables. This migration adds only
-- an append-only, bounded invalidation ledger. NOTIFY remains the one event signal
-- and carries an id/sequence only; reconnect correctness comes from this ledger.

CREATE TABLE IF NOT EXISTS finnor_os.tenant_operational_delta_cursors (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id) ON DELETE CASCADE,
  scope uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  last_seq bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.operational_deltas (
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id) ON DELETE CASCADE,
  seq bigint NOT NULL CHECK (seq > 0),
  change_type text NOT NULL CHECK (change_type ~ '^[a-z0-9_]+\.(insert|update|delete)$'),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  entity_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  work_id uuid REFERENCES finnor_os.works(id) ON DELETE SET NULL,
  projection_tags text[] NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,seq),
  CHECK (jsonb_typeof(entity_refs)='array' AND jsonb_array_length(entity_refs)<=8),
  CHECK (cardinality(projection_tags)<=16),
  CHECK (pg_column_size(entity_refs)<=4096)
);

CREATE INDEX IF NOT EXISTS operational_deltas_tenant_time_idx
  ON finnor_os.operational_deltas(tenant_id,occurred_at);
CREATE INDEX IF NOT EXISTS operational_deltas_tenant_work_idx
  ON finnor_os.operational_deltas(tenant_id,work_id,seq) WHERE work_id IS NOT NULL;

ALTER TABLE finnor_os.tenant_operational_delta_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.tenant_operational_delta_cursors FORCE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.operational_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.operational_deltas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.tenant_operational_delta_cursors;
CREATE POLICY tenant_isolation ON finnor_os.tenant_operational_delta_cursors
  USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id());
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.operational_deltas;
CREATE POLICY tenant_isolation ON finnor_os.operational_deltas
  USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id());

-- A caller cannot rewrite durable history. Deletion is withheld from the app role
-- but remains available to the retention worker/migration owner.
CREATE OR REPLACE FUNCTION finnor_os.prevent_operational_delta_update() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN RAISE EXCEPTION 'operational_deltas is append-only'; END $$;
REVOKE ALL ON FUNCTION finnor_os.prevent_operational_delta_update() FROM PUBLIC;
DROP TRIGGER IF EXISTS operational_deltas_append_only ON finnor_os.operational_deltas;
CREATE TRIGGER operational_deltas_append_only BEFORE UPDATE ON finnor_os.operational_deltas
  FOR EACH ROW EXECUTE FUNCTION finnor_os.prevent_operational_delta_update();

CREATE OR REPLACE FUNCTION finnor_os.ensure_operational_delta_cursor(p_tenant uuid)
RETURNS TABLE(scope uuid,last_seq bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF p_tenant IS DISTINCT FROM finnor_os.request_tenant_id() THEN
    RAISE EXCEPTION 'operational cursor tenant mismatch';
  END IF;
  INSERT INTO finnor_os.tenant_operational_delta_cursors(tenant_id)
    VALUES (p_tenant) ON CONFLICT (tenant_id) DO NOTHING;
  RETURN QUERY SELECT c.scope,c.last_seq
    FROM finnor_os.tenant_operational_delta_cursors c WHERE c.tenant_id=p_tenant;
END $$;
REVOKE ALL ON FUNCTION finnor_os.ensure_operational_delta_cursor(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.purge_operational_deltas(p_tenant uuid,p_before timestamptz)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE deleted bigint;
BEGIN
  IF p_tenant IS DISTINCT FROM finnor_os.request_tenant_id() THEN
    RAISE EXCEPTION 'operational delta retention tenant mismatch';
  END IF;
  DELETE FROM finnor_os.operational_deltas WHERE tenant_id=p_tenant AND occurred_at<p_before;
  GET DIAGNOSTICS deleted=ROW_COUNT;
  RETURN deleted;
END $$;
REVOKE ALL ON FUNCTION finnor_os.purge_operational_deltas(uuid,timestamptz) FROM PUBLIC;

-- One generic trigger function for every covered source. Arguments are canonical
-- entity type (empty if none), projection tags, optional work-id column, optional
-- canonical id column. No NEW row data is serialized into the ledger or NOTIFY.
CREATE OR REPLACE FUNCTION finnor_os.append_operational_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE
  tenant uuid := (to_jsonb(NEW)->>'tenant_id')::uuid;
  row_id uuid;
  work uuid;
  next_seq bigint;
  priority_value text := 'normal';
  status_value text := coalesce(to_jsonb(NEW)->>'status',to_jsonb(NEW)->>'connection_status','');
  refs jsonb := '[]'::jsonb;
  tags text[] := string_to_array(TG_ARGV[1],',');
BEGIN
  IF tenant IS NULL THEN RAISE EXCEPTION 'operational delta source has no tenant'; END IF;
  IF coalesce(TG_ARGV[0],'')<>'' THEN
    row_id := (to_jsonb(NEW)->>coalesce(nullif(TG_ARGV[3],''),'id'))::uuid;
    IF row_id IS NOT NULL THEN
      refs := jsonb_build_array(jsonb_build_object('entityType',TG_ARGV[0],'entityId',row_id));
    END IF;
  END IF;
  IF coalesce(TG_ARGV[2],'')<>'' THEN work := (to_jsonb(NEW)->>TG_ARGV[2])::uuid; END IF;

  IF status_value IN ('pending','awaiting_approval','blocked','failed','needs_human_review',
      'blocked_integration_unavailable','expired','reauth_required','revoked','misconfigured',
      'provider_unavailable','down') THEN
    priority_value := 'high';
  ELSIF TG_TABLE_NAME IN ('inventory_items','business_events','messages','calls') THEN
    priority_value := 'low';
  END IF;

  INSERT INTO finnor_os.tenant_operational_delta_cursors(tenant_id,last_seq)
  VALUES (tenant,1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_seq=finnor_os.tenant_operational_delta_cursors.last_seq+1,updated_at=now()
  RETURNING last_seq INTO next_seq;

  INSERT INTO finnor_os.operational_deltas(
    tenant_id,seq,change_type,priority,entity_refs,work_id,projection_tags
  ) VALUES (
    tenant,next_seq,TG_TABLE_NAME||'.'||lower(TG_OP),priority_value,refs,work,tags
  );

  PERFORM pg_notify('jarvis_events',json_build_object(
    'tenantId',tenant,'kind','operational_delta','id',next_seq::text,
    'ts',to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.append_operational_delta() FROM PUBLIC;

-- Business truth, Work/action/approval, integration, computer and receipt coverage.
DROP TRIGGER IF EXISTS households_operational_delta ON finnor_os.households;
CREATE TRIGGER households_operational_delta AFTER INSERT OR UPDATE ON finnor_os.households FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('household','customers,work,queries','','');
DROP TRIGGER IF EXISTS contacts_operational_delta ON finnor_os.contacts;
CREATE TRIGGER contacts_operational_delta AFTER INSERT OR UPDATE ON finnor_os.contacts FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('contact','customers,work,queries','','');
DROP TRIGGER IF EXISTS equipment_operational_delta ON finnor_os.equipment;
CREATE TRIGGER equipment_operational_delta AFTER INSERT OR UPDATE ON finnor_os.equipment FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('equipment','customers,work,queries','','');
DROP TRIGGER IF EXISTS service_visits_operational_delta ON finnor_os.service_visits;
CREATE TRIGGER service_visits_operational_delta AFTER INSERT OR UPDATE ON finnor_os.service_visits FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('service_visit','schedule,customers,work,queries','','');
DROP TRIGGER IF EXISTS appointments_operational_delta ON finnor_os.appointments;
CREATE TRIGGER appointments_operational_delta AFTER INSERT OR UPDATE ON finnor_os.appointments FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('appointment','schedule,customers,work,queries','','');
DROP TRIGGER IF EXISTS invoices_operational_delta ON finnor_os.invoices;
CREATE TRIGGER invoices_operational_delta AFTER INSERT OR UPDATE ON finnor_os.invoices FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('invoice','money,customers,work,queries','','');
DROP TRIGGER IF EXISTS payments_operational_delta ON finnor_os.payments;
CREATE TRIGGER payments_operational_delta AFTER INSERT OR UPDATE ON finnor_os.payments FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('payment','money,customers,work,receipts,queries','','');
DROP TRIGGER IF EXISTS inventory_items_operational_delta ON finnor_os.inventory_items;
CREATE TRIGGER inventory_items_operational_delta AFTER INSERT OR UPDATE ON finnor_os.inventory_items FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('inventory_item','inventory,work,queries','','');
DROP TRIGGER IF EXISTS works_operational_delta ON finnor_os.works;
CREATE TRIGGER works_operational_delta AFTER INSERT OR UPDATE OF status,active_context,final_outcome,failure ON finnor_os.works FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('work','work,actions,approvals,workflows,receipts,activity,queries','id','');
DROP TRIGGER IF EXISTS domain_actions_operational_delta ON finnor_os.domain_actions;
CREATE TRIGGER domain_actions_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.domain_actions FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('domain_action','actions,approvals,work,receipts,activity,queries','work_id','');
DROP TRIGGER IF EXISTS workflow_runs_operational_delta ON finnor_os.workflow_runs;
CREATE TRIGGER workflow_runs_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.workflow_runs FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('workflow_run','workflows,work,actions,approvals,receipts,activity,queries','work_id','');
DROP TRIGGER IF EXISTS workflow_steps_operational_delta ON finnor_os.workflow_steps;
CREATE TRIGGER workflow_steps_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.workflow_steps FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('workflow_step','workflows,work,actions,approvals,receipts,activity,queries','','');
DROP TRIGGER IF EXISTS authority_approval_requests_operational_delta ON finnor_os.authority_approval_requests;
CREATE TRIGGER authority_approval_requests_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.authority_approval_requests FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('','approvals,actions,work,activity,queries','','');
DROP TRIGGER IF EXISTS decision_receipts_operational_delta ON finnor_os.decision_receipts;
CREATE TRIGGER decision_receipts_operational_delta AFTER INSERT OR UPDATE OF finalized_at ON finnor_os.decision_receipts FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('decision_receipt','receipts,actions,approvals,work,workflows,activity,queries','work_id','');
DROP TRIGGER IF EXISTS integration_events_operational_delta ON finnor_os.integration_events;
CREATE TRIGGER integration_events_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.integration_events FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('','agents,work,activity,queries','work_id','');
DROP TRIGGER IF EXISTS computer_runs_operational_delta ON finnor_os.computer_runs;
CREATE TRIGGER computer_runs_operational_delta AFTER INSERT OR UPDATE OF status,effect_status ON finnor_os.computer_runs FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('computer_run','computer,agents,work,actions,receipts,activity,queries','work_id','');
DROP TRIGGER IF EXISTS business_events_operational_delta ON finnor_os.business_events;
CREATE TRIGGER business_events_operational_delta AFTER INSERT ON finnor_os.business_events FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('business_event','events,activity,work,customers,schedule,money,inventory,computer,queries','','');
DROP TRIGGER IF EXISTS auth_profiles_operational_delta ON finnor_os.auth_profiles;
CREATE TRIGGER auth_profiles_operational_delta AFTER INSERT OR UPDATE OF status,connection_status ON finnor_os.auth_profiles FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('','agents,system,work,queries','','');
DROP TRIGGER IF EXISTS connection_events_operational_delta ON finnor_os.connection_events;
CREATE TRIGGER connection_events_operational_delta AFTER INSERT ON finnor_os.connection_events FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('','agents,system,work,activity,queries','','');

-- Promote two existing operational rows into the canonical identity seam.
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
    WHEN 'inventory_item' THEN SELECT tenant_id INTO resolved FROM finnor_os.inventory_items WHERE id=p_id;
    WHEN 'computer_run' THEN SELECT tenant_id INTO resolved FROM finnor_os.computer_runs WHERE id=p_id;
    ELSE RAISE EXCEPTION 'unsupported canonical entity type: %',p_type;
  END CASE;
  RETURN resolved;
END $$;
REVOKE ALL ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) FROM PUBLIC;

ALTER TABLE finnor_os.work_entity_links DROP CONSTRAINT IF EXISTS work_entity_links_entity_type_check;
ALTER TABLE finnor_os.work_entity_links ADD CONSTRAINT work_entity_links_entity_type_check CHECK (entity_type IN (
  'household','contact','user','technician','equipment','service_visit','maintenance_agreement',
  'lead','opportunity','quote','proposal','work_order','appointment','invoice','payment',
  'conversation','call','message','communication','document','task','work','domain_action','workflow_run','workflow_step',
  'business_operation','business_operation_target','decision_receipt','business_event','org_unit','tenant_location',
  'external_organization','external_contact','delegation','acknowledgement_request','communication_delivery',
  'internal_event','document_share','inventory_item','computer_run'
));

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    REVOKE INSERT,UPDATE,DELETE ON finnor_os.tenant_operational_delta_cursors,finnor_os.operational_deltas FROM finnor_app;
    GRANT SELECT ON finnor_os.tenant_operational_delta_cursors,finnor_os.operational_deltas TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.ensure_operational_delta_cursor(uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.purge_operational_deltas(uuid,timestamptz) TO finnor_app;
  END IF;
END $grants$;
