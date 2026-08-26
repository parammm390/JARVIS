-- Phase 1 generic home-services kernel + persisted Planning IR identity.
-- Additive only: household remains the customer/account and equipment remains the
-- canonical asset. Historical rows with no trustworthy service address stay
-- explicitly UNRESOLVED.

DO $parent_keys$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='households_tenant_id_id_key') THEN
    ALTER TABLE finnor_os.households ADD CONSTRAINT households_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='equipment_tenant_id_id_key') THEN
    ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='domain_actions_tenant_id_id_key') THEN
    ALTER TABLE finnor_os.domain_actions ADD CONSTRAINT domain_actions_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='work_objective_steps_tenant_id_id_key') THEN
    ALTER TABLE finnor_os.work_objective_steps ADD CONSTRAINT work_objective_steps_tenant_id_id_key UNIQUE (tenant_id,id);
  END IF;
END $parent_keys$;

CREATE TABLE IF NOT EXISTS finnor_os.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT finnor_os.request_tenant_id() REFERENCES finnor_os.tenants(id),
  household_id uuid NOT NULL REFERENCES finnor_os.households(id) ON DELETE CASCADE,
  label text,
  address text NOT NULL,
  kind text NOT NULL DEFAULT 'unknown' CHECK (kind IN ('residential','commercial','service_location','unknown')),
  link_status text NOT NULL DEFAULT 'RESOLVED' CHECK (link_status IN ('RESOLVED','UNRESOLVED')),
  latitude real,
  longitude real,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT properties_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT properties_tenant_household_id_key UNIQUE (tenant_id,household_id,id),
  CONSTRAINT properties_tenant_household_fk FOREIGN KEY (tenant_id,household_id) REFERENCES finnor_os.households(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS properties_source_identity_key ON finnor_os.properties(tenant_id,source_system,external_id);
CREATE INDEX IF NOT EXISTS properties_tenant_household_idx ON finnor_os.properties(tenant_id,household_id);

-- One address-bearing legacy household can prove one service location. Placeholder
-- addresses cannot, so they deliberately receive no guessed property row.
INSERT INTO finnor_os.properties (
  id,tenant_id,household_id,label,address,kind,link_status,latitude,longitude,source_system,external_id,created_by
)
SELECT (
    substr(md5('finnor-property-v1:' || h.id::text),1,8) || '-' ||
    substr(md5('finnor-property-v1:' || h.id::text),9,4) || '-4' ||
    substr(md5('finnor-property-v1:' || h.id::text),14,3) || '-a' ||
    substr(md5('finnor-property-v1:' || h.id::text),18,3) || '-' ||
    substr(md5('finnor-property-v1:' || h.id::text),21,12)
  )::uuid,
  h.tenant_id,h.id,'Primary service location',h.address,'unknown','RESOLVED',h.latitude,h.longitude,
  'phase1_backfill','household:' || h.id::text,'migration:0102'
FROM finnor_os.households h
WHERE btrim(h.address)<>''
  AND lower(regexp_replace(btrim(h.address),'[[:space:]]+',' ','g')) NOT IN (
    '(address pending)','address pending','pending','unknown','n/a','na','none',
    'not provided','no address','tbd','-'
  )
ON CONFLICT (tenant_id,source_system,external_id) DO NOTHING;

ALTER TABLE finnor_os.equipment ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE finnor_os.equipment ADD COLUMN IF NOT EXISTS property_link_status text NOT NULL DEFAULT 'UNRESOLVED';
ALTER TABLE finnor_os.equipment ADD COLUMN IF NOT EXISTS asset_domain text NOT NULL DEFAULT 'UNRESOLVED';

UPDATE finnor_os.equipment e
SET property_id=p.id,property_link_status='RESOLVED'
FROM finnor_os.properties p
WHERE p.tenant_id=e.tenant_id AND p.household_id=e.household_id
  AND p.link_status='RESOLVED' AND p.archived_at IS NULL
  AND e.property_id IS NULL
  AND 1=(SELECT count(*) FROM finnor_os.properties p2 WHERE p2.tenant_id=e.tenant_id AND p2.household_id=e.household_id AND p2.link_status='RESOLVED' AND p2.archived_at IS NULL);

ALTER TABLE finnor_os.equipment DROP CONSTRAINT IF EXISTS equipment_property_link_status_check;
ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_property_link_status_check CHECK (
  (property_id IS NULL AND property_link_status='UNRESOLVED') OR
  (property_id IS NOT NULL AND property_link_status='RESOLVED')
);
ALTER TABLE finnor_os.equipment DROP CONSTRAINT IF EXISTS equipment_asset_domain_check;
ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_asset_domain_check CHECK (asset_domain IN ('WATER','HVAC','PLUMBING','GENERIC','UNRESOLVED'));
ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_tenant_household_property_fk
  FOREIGN KEY (tenant_id,household_id,property_id) REFERENCES finnor_os.properties(tenant_id,household_id,id);
ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_tenant_household_property_id_key UNIQUE (tenant_id,household_id,property_id,id);
CREATE INDEX IF NOT EXISTS equipment_tenant_property_idx ON finnor_os.equipment(tenant_id,property_id);

ALTER TABLE finnor_os.service_visits ADD COLUMN IF NOT EXISTS property_id uuid;
ALTER TABLE finnor_os.service_visits ADD COLUMN IF NOT EXISTS equipment_id uuid;
UPDATE finnor_os.service_visits v
SET property_id=p.id
FROM finnor_os.properties p
WHERE p.tenant_id=v.tenant_id AND p.household_id=v.household_id
  AND p.link_status='RESOLVED' AND p.archived_at IS NULL
  AND v.property_id IS NULL
  AND 1=(SELECT count(*) FROM finnor_os.properties p2 WHERE p2.tenant_id=v.tenant_id AND p2.household_id=v.household_id AND p2.link_status='RESOLVED' AND p2.archived_at IS NULL);
ALTER TABLE finnor_os.service_visits ADD CONSTRAINT service_visits_tenant_household_property_fk
  FOREIGN KEY (tenant_id,household_id,property_id) REFERENCES finnor_os.properties(tenant_id,household_id,id);
ALTER TABLE finnor_os.service_visits ADD CONSTRAINT service_visits_tenant_equipment_fk
  FOREIGN KEY (tenant_id,equipment_id) REFERENCES finnor_os.equipment(tenant_id,id);

-- Appointment identity remains unchanged and its polymorphic subject stays intact.
-- The property link is additive and backfilled only through an unambiguous household.
ALTER TABLE finnor_os.appointments ADD COLUMN IF NOT EXISTS property_id uuid;
UPDATE finnor_os.appointments a
SET property_id=p.id
FROM finnor_os.properties p
WHERE p.tenant_id=a.tenant_id
  AND p.household_id=CASE
    WHEN a.subject_type='household' THEN a.subject_id
    WHEN a.subject_type='work_order' THEN (
      SELECT wo.household_id FROM finnor_os.work_orders wo
      WHERE wo.tenant_id=a.tenant_id AND wo.id=a.subject_id
    )
    ELSE NULL
  END
  AND p.link_status='RESOLVED' AND p.archived_at IS NULL
  AND a.property_id IS NULL
  AND 1=(
    SELECT count(*) FROM finnor_os.properties p2
    WHERE p2.tenant_id=p.tenant_id AND p2.household_id=p.household_id
      AND p2.link_status='RESOLVED' AND p2.archived_at IS NULL
  );
ALTER TABLE finnor_os.appointments ADD CONSTRAINT appointments_tenant_property_fk
  FOREIGN KEY (tenant_id,property_id) REFERENCES finnor_os.properties(tenant_id,id);

CREATE TABLE IF NOT EXISTS finnor_os.asset_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT finnor_os.request_tenant_id() REFERENCES finnor_os.tenants(id),
  household_id uuid NOT NULL REFERENCES finnor_os.households(id),
  property_id uuid NOT NULL,
  equipment_id uuid NOT NULL,
  measurement_type text NOT NULL CHECK (btrim(measurement_type)<>''),
  value jsonb NOT NULL,
  unit text,
  observed_at timestamptz NOT NULL,
  source text NOT NULL CHECK (btrim(source)<>''),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_measurements_tenant_property_fk FOREIGN KEY (tenant_id,household_id,property_id) REFERENCES finnor_os.properties(tenant_id,household_id,id),
  CONSTRAINT asset_measurements_tenant_equipment_fk FOREIGN KEY (tenant_id,household_id,property_id,equipment_id) REFERENCES finnor_os.equipment(tenant_id,household_id,property_id,id)
);
CREATE INDEX IF NOT EXISTS asset_measurements_tenant_asset_observed_idx ON finnor_os.asset_measurements(tenant_id,equipment_id,observed_at DESC);

CREATE TABLE IF NOT EXISTS finnor_os.planning_ir_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  work_id uuid REFERENCES finnor_os.works(id),
  objective_step_id uuid REFERENCES finnor_os.work_objective_steps(id),
  ir_schema_version text NOT NULL CHECK (btrim(ir_schema_version)<>''),
  compiler_version text NOT NULL CHECK (btrim(compiler_version)<>''),
  ir_semantic_hash text NOT NULL CHECK (ir_semantic_hash ~ '^[0-9a-f]{64}$'),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance)='object'),
  artifact jsonb NOT NULL CHECK (jsonb_typeof(artifact)='object' AND octet_length(artifact::text)<=1048576),
  status text NOT NULL CHECK (status IN ('shadow','accepted','rejected','lowered')),
  comparison_classification text NOT NULL CHECK (comparison_classification IN ('EQUIVALENT','EXPECTED_IMPROVEMENT','REGRESSION','LEGACY_UNSUPPORTED','IR_UNSUPPORTED','FIXTURE_INVALID')),
  semantic_diff jsonb NOT NULL CHECK (jsonb_typeof(semantic_diff)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planning_ir_artifacts_action_idx UNIQUE (domain_action_id),
  CONSTRAINT planning_ir_artifacts_action_tenant_fk FOREIGN KEY (tenant_id,domain_action_id) REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT planning_ir_artifacts_work_tenant_fk FOREIGN KEY (tenant_id,work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT planning_ir_artifacts_step_tenant_fk FOREIGN KEY (tenant_id,objective_step_id) REFERENCES finnor_os.work_objective_steps(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS planning_ir_artifacts_tenant_hash_idx ON finnor_os.planning_ir_artifacts(tenant_id,ir_semantic_hash);
CREATE INDEX IF NOT EXISTS planning_ir_artifacts_work_idx ON finnor_os.planning_ir_artifacts(work_id,created_at);

CREATE OR REPLACE FUNCTION finnor_os.freeze_planning_ir_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id
     OR NEW.work_id IS DISTINCT FROM OLD.work_id
     OR NEW.objective_step_id IS DISTINCT FROM OLD.objective_step_id
     OR NEW.ir_schema_version IS DISTINCT FROM OLD.ir_schema_version
     OR NEW.compiler_version IS DISTINCT FROM OLD.compiler_version
     OR NEW.ir_semantic_hash IS DISTINCT FROM OLD.ir_semantic_hash
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.artifact IS DISTINCT FROM OLD.artifact
     OR NEW.comparison_classification IS DISTINCT FROM OLD.comparison_classification
     OR NEW.semantic_diff IS DISTINCT FROM OLD.semantic_diff THEN
    RAISE EXCEPTION 'Planning IR semantic identity is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.freeze_planning_ir_identity() FROM PUBLIC;
DROP TRIGGER IF EXISTS planning_ir_identity_immutable ON finnor_os.planning_ir_artifacts;
CREATE TRIGGER planning_ir_identity_immutable BEFORE UPDATE ON finnor_os.planning_ir_artifacts
  FOR EACH ROW EXECUTE FUNCTION finnor_os.freeze_planning_ir_identity();

DO $tenant_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['properties','asset_measurements','planning_ir_artifacts'] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
END $tenant_rls$;

-- Extend the one existing canonical resolver; there is no second grounding map.
CREATE OR REPLACE FUNCTION finnor_os.canonical_entity_tenant(p_type text,p_id uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved uuid;
BEGIN
  CASE p_type
    WHEN 'household' THEN SELECT tenant_id INTO resolved FROM finnor_os.households WHERE id=p_id;
    WHEN 'property' THEN SELECT tenant_id INTO resolved FROM finnor_os.properties WHERE id=p_id;
    WHEN 'asset_measurement' THEN SELECT tenant_id INTO resolved FROM finnor_os.asset_measurements WHERE id=p_id;
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
  'household','property','asset_measurement','contact','user','technician','equipment','service_visit','maintenance_agreement',
  'lead','opportunity','quote','proposal','work_order','appointment','invoice','payment',
  'conversation','call','message','communication','document','task','work','domain_action','workflow_run','workflow_step',
  'business_operation','business_operation_target','decision_receipt','business_event','org_unit','tenant_location',
  'external_organization','external_contact','delegation','acknowledgement_request','communication_delivery',
  'internal_event','document_share','inventory_item','computer_run'
));

DO $grants$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    FOREACH table_name IN ARRAY ARRAY['properties','asset_measurements','planning_ir_artifacts'] LOOP
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.%I TO finnor_app',table_name);
    END LOOP;
    GRANT EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) TO finnor_app;
  END IF;
END $grants$;
