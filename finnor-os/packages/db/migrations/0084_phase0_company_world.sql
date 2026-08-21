-- Phase 0: Company World + addressability foundation.
--
-- `users` remains the only canonical employee identity.  These additive rows
-- provide tenant-scoped teams, employee relationships, aliases, external parties,
-- and user-to-location assignments without creating a second identity system.
-- Every reference that can be represented by a normal foreign key carries the
-- tenant in the key.  Party aliases and Work links are polymorphic, so their
-- tenant equality is enforced by trigger even for a table owner/bypass role.

-- Composite parent keys let ordinary PostgreSQL foreign keys enforce tenant
-- equality independently of RLS.  This is important for provisioning/admin
-- connections, which may intentionally use row_security=off.
ALTER TABLE finnor_os.users
  ADD COLUMN IF NOT EXISTS primary_location_id uuid;

DO $parent_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenants_id_client_key_key'
      AND conrelid = 'finnor_os.tenants'::regclass
  ) THEN
    ALTER TABLE finnor_os.tenants
      ADD CONSTRAINT tenants_id_client_key_key UNIQUE (id, client_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_tenant_id_id_key'
      AND conrelid = 'finnor_os.users'::regclass
  ) THEN
    ALTER TABLE finnor_os.users
      ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_locations_tenant_id_id_key'
      AND conrelid = 'finnor_os.tenant_locations'::regclass
  ) THEN
    ALTER TABLE finnor_os.tenant_locations
      ADD CONSTRAINT tenant_locations_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_primary_location_tenant_fkey'
      AND conrelid = 'finnor_os.users'::regclass
  ) THEN
    ALTER TABLE finnor_os.users
      ADD CONSTRAINT users_primary_location_tenant_fkey
      FOREIGN KEY (tenant_id, primary_location_id)
      REFERENCES finnor_os.tenant_locations(tenant_id, id);
  END IF;
END $parent_keys$;

CREATE INDEX IF NOT EXISTS users_tenant_primary_location_idx
  ON finnor_os.users (tenant_id, primary_location_id)
  WHERE primary_location_id IS NOT NULL;

-- Supabase may install unaccent in `extensions`, while local PostgreSQL commonly
-- installs it in `public`. Resolve the extension namespace once and embed it as a
-- schema-qualified call in a fixed-search-path helper; never depend on ambient
-- search_path or a hardcoded extension schema.
DO $normalize_party_text$
DECLARE
  unaccent_schema text;
BEGIN
  CREATE EXTENSION IF NOT EXISTS unaccent;
  SELECT n.nspname INTO unaccent_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'unaccent';
  IF unaccent_schema IS NULL THEN
    RAISE EXCEPTION 'unaccent extension is not installed';
  END IF;

  EXECUTE format($function$
    CREATE OR REPLACE FUNCTION finnor_os.normalize_party_text(p_text text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    SET search_path = pg_catalog, %1$I
    AS $body$
      SELECT btrim(regexp_replace(
               regexp_replace(lower(btrim(%1$I.unaccent(coalesce(p_text, '')))), '[^a-z0-9]+', ' ', 'g'),
               '[[:space:]]+', ' ', 'g'
             ))
    $body$;
  $function$, unaccent_schema);
END $normalize_party_text$;
REVOKE EXECUTE ON FUNCTION finnor_os.normalize_party_text(text) FROM PUBLIC;

ALTER TABLE finnor_os.work_query_executions
  DROP CONSTRAINT IF EXISTS work_query_executions_intent_check;
ALTER TABLE finnor_os.work_query_executions
  ADD CONSTRAINT work_query_executions_intent_check CHECK (intent IN (
    'customer_lookup','customer_cohort','schedule_range','money_summary','work_list',
    'inventory_status','agent_activity','business_state','company_context',
    'party_lookup','party_context','team_roster','party_availability'
  ));

CREATE TABLE IF NOT EXISTS finnor_os.org_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  unit_key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'team'
    CHECK (kind IN ('team','department')),
  description text,
  location_id uuid,
  active boolean NOT NULL DEFAULT true,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_units_unit_key_format_check
    CHECK (unit_key = lower(unit_key) AND unit_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT org_units_tenant_key_unique UNIQUE (tenant_id, unit_key),
  CONSTRAINT org_units_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT org_units_location_tenant_fkey
    FOREIGN KEY (tenant_id, location_id)
    REFERENCES finnor_os.tenant_locations(tenant_id, id),
  CONSTRAINT org_units_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS org_units_tenant_active_key_idx
  ON finnor_os.org_units (tenant_id, active, unit_key);
CREATE INDEX IF NOT EXISTS org_units_tenant_name_idx
  ON finnor_os.org_units (tenant_id, name);
CREATE INDEX IF NOT EXISTS org_units_tenant_location_idx
  ON finnor_os.org_units (tenant_id, location_id)
  WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS org_units_tenant_managed_by_idx
  ON finnor_os.org_units (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.org_unit_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  org_unit_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  membership_role text,
  is_primary boolean NOT NULL DEFAULT false,
  managed_by text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_unit_memberships_identity_unique
    UNIQUE (tenant_id, org_unit_id, employee_id),
  CONSTRAINT org_unit_memberships_tenant_id_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT org_unit_memberships_org_unit_tenant_fkey
    FOREIGN KEY (tenant_id, org_unit_id)
    REFERENCES finnor_os.org_units(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT org_unit_memberships_employee_tenant_fkey
    FOREIGN KEY (tenant_id, employee_id)
    REFERENCES finnor_os.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT org_unit_memberships_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS org_unit_memberships_tenant_unit_active_idx
  ON finnor_os.org_unit_memberships (tenant_id, org_unit_id, active, employee_id);
CREATE INDEX IF NOT EXISTS org_unit_memberships_tenant_employee_active_idx
  ON finnor_os.org_unit_memberships (tenant_id, employee_id, active, org_unit_id);
CREATE INDEX IF NOT EXISTS org_unit_memberships_tenant_managed_by_idx
  ON finnor_os.org_unit_memberships (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.employee_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  subject_employee_id uuid NOT NULL,
  related_employee_id uuid NOT NULL,
  relationship_type text NOT NULL
    CHECK (relationship_type IN ('manager','backup','assistant')),
  active boolean NOT NULL DEFAULT true,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_relationships_identity_unique
    UNIQUE (tenant_id, subject_employee_id, relationship_type, related_employee_id),
  CONSTRAINT employee_relationships_tenant_id_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT employee_relationships_not_self_check
    CHECK (subject_employee_id <> related_employee_id),
  CONSTRAINT employee_relationships_subject_employee_tenant_fkey
    FOREIGN KEY (tenant_id, subject_employee_id)
    REFERENCES finnor_os.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT employee_relationships_related_employee_tenant_fkey
    FOREIGN KEY (tenant_id, related_employee_id)
    REFERENCES finnor_os.users(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT employee_relationships_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS employee_relationships_tenant_employee_type_idx
  ON finnor_os.employee_relationships (tenant_id, subject_employee_id, relationship_type, active);
CREATE INDEX IF NOT EXISTS employee_relationships_tenant_related_type_idx
  ON finnor_os.employee_relationships (tenant_id, related_employee_id, relationship_type, active);
CREATE INDEX IF NOT EXISTS employee_relationships_tenant_managed_by_idx
  ON finnor_os.employee_relationships (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.external_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  organization_key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'other'
    CHECK (kind IN ('supplier','vendor','distributor','partner','contractor','agency','other')),
  business_email text,
  business_phone text,
  active boolean NOT NULL DEFAULT true,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_organizations_key_format_check
    CHECK (organization_key = lower(organization_key) AND organization_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT external_organizations_tenant_key_unique
    UNIQUE (tenant_id, organization_key),
  CONSTRAINT external_organizations_tenant_id_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT external_organizations_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS external_organizations_tenant_active_name_idx
  ON finnor_os.external_organizations (tenant_id, active, name, id);
CREATE INDEX IF NOT EXISTS external_organizations_tenant_type_active_idx
  ON finnor_os.external_organizations (tenant_id, kind, active, id);
CREATE INDEX IF NOT EXISTS external_organizations_tenant_email_idx
  ON finnor_os.external_organizations (tenant_id, lower(business_email), id)
  WHERE business_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_organizations_tenant_phone_idx
  ON finnor_os.external_organizations (tenant_id, business_phone, id)
  WHERE business_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_organizations_tenant_managed_by_idx
  ON finnor_os.external_organizations (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.external_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  contact_key text NOT NULL,
  external_organization_id uuid,
  name text NOT NULL,
  title text,
  business_email text,
  business_phone text,
  active boolean NOT NULL DEFAULT true,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_contacts_key_format_check
    CHECK (contact_key = lower(contact_key) AND contact_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT external_contacts_tenant_key_unique
    UNIQUE (tenant_id, contact_key),
  CONSTRAINT external_contacts_tenant_id_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT external_contacts_organization_tenant_fkey
    FOREIGN KEY (tenant_id, external_organization_id)
    REFERENCES finnor_os.external_organizations(tenant_id, id),
  CONSTRAINT external_contacts_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS external_contacts_tenant_active_name_idx
  ON finnor_os.external_contacts (tenant_id, active, name, id);
CREATE INDEX IF NOT EXISTS external_contacts_tenant_organization_idx
  ON finnor_os.external_contacts (tenant_id, external_organization_id, active, id)
  WHERE external_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_contacts_tenant_email_idx
  ON finnor_os.external_contacts (tenant_id, lower(business_email), id)
  WHERE business_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_contacts_tenant_phone_idx
  ON finnor_os.external_contacts (tenant_id, business_phone, id)
  WHERE business_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_contacts_tenant_managed_by_idx
  ON finnor_os.external_contacts (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.party_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  alias_key text NOT NULL,
  party_type text NOT NULL CHECK (party_type IN (
    'employee','team','location','household','contact','external_organization','external_contact'
  )),
  party_id uuid NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_aliases_alias_nonempty_check CHECK (btrim(alias) <> ''),
  CONSTRAINT party_aliases_normalized_nonempty_check CHECK (normalized_alias <> ''),
  CONSTRAINT party_aliases_alias_key_format_check
    CHECK (alias_key = lower(alias_key) AND alias_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT party_aliases_tenant_key_unique
    UNIQUE (tenant_id, alias_key),
  CONSTRAINT party_aliases_tenant_id_id_key
    UNIQUE (tenant_id, id),
  CONSTRAINT party_aliases_identity_unique
    UNIQUE (tenant_id, party_type, party_id, normalized_alias),
  CONSTRAINT party_aliases_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id, managed_by)
    REFERENCES finnor_os.tenants(id, client_key)
);

CREATE INDEX IF NOT EXISTS party_aliases_tenant_normalized_active_idx
  ON finnor_os.party_aliases (tenant_id, normalized_alias, active, party_type, party_id);
CREATE INDEX IF NOT EXISTS party_aliases_tenant_party_active_idx
  ON finnor_os.party_aliases (tenant_id, party_type, party_id, active);
CREATE INDEX IF NOT EXISTS party_aliases_tenant_managed_by_idx
  ON finnor_os.party_aliases (tenant_id, managed_by)
  WHERE managed_by IS NOT NULL;

-- The trigger must be installed after the table exists.  The DROP/CREATE above
-- is intentionally idempotent for migration replay.
CREATE OR REPLACE FUNCTION finnor_os.assert_party_alias_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  party_tenant uuid;
BEGIN
  NEW.alias := btrim(NEW.alias);
  NEW.normalized_alias := finnor_os.normalize_party_text(NEW.alias);
  IF NEW.normalized_alias = '' THEN
    RAISE EXCEPTION 'party alias cannot be empty';
  END IF;

  CASE NEW.party_type
    WHEN 'employee' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.users WHERE id = NEW.party_id;
    WHEN 'team' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.org_units WHERE id = NEW.party_id;
    WHEN 'location' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.tenant_locations WHERE id = NEW.party_id;
    WHEN 'household' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.households WHERE id = NEW.party_id;
    WHEN 'contact' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.contacts WHERE id = NEW.party_id;
    WHEN 'external_organization' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.external_organizations WHERE id = NEW.party_id;
    WHEN 'external_contact' THEN
      SELECT tenant_id INTO party_tenant FROM finnor_os.external_contacts WHERE id = NEW.party_id;
    ELSE
      RAISE EXCEPTION 'unsupported party alias type: %', NEW.party_type;
  END CASE;

  IF party_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'party alias reference crosses tenant boundary or is missing';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_party_alias_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS party_alias_scope ON finnor_os.party_aliases;
CREATE TRIGGER party_alias_scope
  BEFORE INSERT OR UPDATE ON finnor_os.party_aliases
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_party_alias_scope();

-- Canonical entity resolution now includes the Phase 0 company parties. It accepts
-- only stored canonical entity types; employee/team/location remain PartyRef names
-- at the shared conversion seam and never become a second graph vocabulary.
CREATE OR REPLACE FUNCTION finnor_os.canonical_entity_tenant(p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
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
    ELSE RAISE EXCEPTION 'unsupported canonical entity type: %', p_type;
  END CASE;
  RETURN resolved;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text, uuid) FROM PUBLIC;

ALTER TABLE finnor_os.work_entity_links
  DROP CONSTRAINT IF EXISTS work_entity_links_entity_type_check;
ALTER TABLE finnor_os.work_entity_links
  ADD CONSTRAINT work_entity_links_entity_type_check CHECK (entity_type IN (
    'household','contact','user','technician','equipment','service_visit','maintenance_agreement',
    'lead','opportunity','quote','proposal','work_order','appointment','invoice','payment',
    'conversation','call','message','communication','document','task','work','domain_action','workflow_run','workflow_step',
    'business_operation','business_operation_target','decision_receipt','business_event',
    'org_unit','tenant_location','external_organization','external_contact'
  ));

-- Recreate the existing Company Graph surface in place.  V2 is the contract
-- evolution, not a second graph view: callers continue to use company_graph_edges.
-- The view is security-invoker so source-table RLS remains effective, while the
-- canonical tenant filter prevents stale/forged polymorphic edges from surfacing
-- to an administrative role.
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
    WHERE entity_type IN ('household','contact','user','technician','equipment','service_visit','maintenance_agreement','lead','opportunity','quote','proposal','work_order','appointment','invoice','payment','conversation','call','message','communication','document','task','work','domain_action','workflow_run','workflow_step','business_operation','business_operation_target','decision_receipt','org_unit','tenant_location','external_organization','external_contact')
  UNION ALL SELECT tenant_id,'user',employee_id,'member_of','org_unit',org_unit_id,'org_unit_memberships','org_unit_id' FROM finnor_os.org_unit_memberships WHERE active
  UNION ALL SELECT tenant_id,'org_unit',org_unit_id,'has_member','user',employee_id,'org_unit_memberships','employee_id' FROM finnor_os.org_unit_memberships WHERE active
  UNION ALL SELECT tenant_id,'user',subject_employee_id,relationship_type,'user',related_employee_id,'employee_relationships','related_employee_id' FROM finnor_os.employee_relationships WHERE active
  UNION ALL SELECT tenant_id,'user',related_employee_id,'report','user',subject_employee_id,'employee_relationships','subject_employee_id'
    FROM finnor_os.employee_relationships WHERE active AND relationship_type='manager'
  UNION ALL SELECT tenant_id,'org_unit',id,'located_at','tenant_location',location_id,'org_units','location_id' FROM finnor_os.org_units WHERE location_id IS NOT NULL AND active
  UNION ALL SELECT tenant_id,'external_contact',id,'works_for','external_organization',external_organization_id,'external_contacts','external_organization_id' FROM finnor_os.external_contacts WHERE external_organization_id IS NOT NULL AND active
  UNION ALL SELECT tenant_id,'user',id,'located_at','tenant_location',primary_location_id,'users','primary_location_id' FROM finnor_os.users WHERE primary_location_id IS NOT NULL
) edge
WHERE finnor_os.canonical_entity_tenant(edge.from_entity_type, edge.from_entity_id) = edge.tenant_id
  AND finnor_os.canonical_entity_tenant(edge.to_entity_type, edge.to_entity_id) = edge.tenant_id;

-- Bounded, privacy-safe node metadata for CompanyContext V2.  In particular,
-- employee labels never fall back to email and household labels never fall back
-- to address/contact values.  No business email/phone or profile/auth JSON is
-- projected from this view.
CREATE OR REPLACE VIEW finnor_os.company_graph_nodes WITH (security_invoker=true) AS
SELECT tenant_id, 'user'::text AS entity_type, id AS entity_id,
       coalesce(nullif(btrim(display_name), ''), 'Employee') AS label,
       status::text AS status, created_at AS occurred_at, 'users'::text AS source_table
FROM finnor_os.users
UNION ALL
SELECT tenant_id, 'org_unit', id, name,
       CASE WHEN active THEN 'active' ELSE 'inactive' END,
       created_at, 'org_units'
FROM finnor_os.org_units
UNION ALL
SELECT tenant_id, 'tenant_location', id, name,
       CASE WHEN active THEN 'active' ELSE 'inactive' END,
       created_at, 'tenant_locations'
FROM finnor_os.tenant_locations
UNION ALL
SELECT tenant_id, 'household', id,
       coalesce(nullif(btrim(contact_info->>'name'), ''), 'Customer household'),
       'active', created_at, 'households'
FROM finnor_os.households
UNION ALL
SELECT tenant_id, 'contact', id, name,
       CASE WHEN archived_at IS NULL THEN 'active' ELSE 'inactive' END,
       created_at, 'contacts'
FROM finnor_os.contacts
UNION ALL
SELECT tenant_id, 'external_organization', id, name,
       CASE WHEN active THEN 'active' ELSE 'inactive' END,
       created_at, 'external_organizations'
FROM finnor_os.external_organizations
UNION ALL
SELECT tenant_id, 'external_contact', id, name,
       CASE WHEN active THEN 'active' ELSE 'inactive' END,
       created_at, 'external_contacts'
FROM finnor_os.external_contacts
UNION ALL
SELECT tenant_id, 'technician', id, name, 'active', NULL::timestamptz, 'technicians'
FROM finnor_os.technicians
UNION ALL
SELECT tenant_id, 'work', id, 'Work', status::text, updated_at, 'works'
FROM finnor_os.works
UNION ALL
SELECT tenant_id, 'task', id, title, status::text, created_at, 'tasks'
FROM finnor_os.tasks
UNION ALL
SELECT tenant_id, 'equipment', id, 'Equipment', NULL::text, NULL::timestamptz, 'equipment'
FROM finnor_os.equipment
UNION ALL
SELECT tenant_id, 'service_visit', id, 'Service visit', NULL::text, NULL::timestamptz, 'service_visits'
FROM finnor_os.service_visits
UNION ALL
SELECT tenant_id, 'maintenance_agreement', id, 'Maintenance agreement', status::text, renewal_date, 'maintenance_agreements'
FROM finnor_os.maintenance_agreements
UNION ALL
SELECT tenant_id, 'lead', id, 'Lead', status::text, created_at, 'leads'
FROM finnor_os.leads
UNION ALL
SELECT tenant_id, 'opportunity', id, 'Opportunity', pipeline_stage::text, created_at, 'opportunities'
FROM finnor_os.opportunities
UNION ALL
SELECT tenant_id, 'quote', id, 'Quote', status::text, created_at, 'quotes'
FROM finnor_os.quotes
UNION ALL
SELECT tenant_id, 'proposal', id, 'Proposal', status::text, sent_at, 'proposals'
FROM finnor_os.proposals
UNION ALL
SELECT tenant_id, 'work_order', id, 'Work order', status::text, created_at, 'work_orders'
FROM finnor_os.work_orders
UNION ALL
SELECT tenant_id, 'appointment', id, 'Appointment', status::text, scheduled_at, 'appointments'
FROM finnor_os.appointments
UNION ALL
SELECT tenant_id, 'invoice', id, 'Invoice', status::text, created_at, 'invoices'
FROM finnor_os.invoices
UNION ALL
SELECT tenant_id, 'payment', id, 'Payment', status::text, created_at, 'payments'
FROM finnor_os.payments
UNION ALL
SELECT tenant_id, 'conversation', id, 'Conversation', NULL::text, created_at, 'conversations'
FROM finnor_os.conversations
UNION ALL
SELECT tenant_id, 'call', id, 'Call', NULL::text, created_at, 'calls'
FROM finnor_os.calls
UNION ALL
SELECT tenant_id, 'message', id, 'Message', NULL::text, created_at, 'messages'
FROM finnor_os.messages
UNION ALL
SELECT tenant_id, 'communication', id, 'Communication', NULL::text, "timestamp", 'communications_log'
FROM finnor_os.communications_log
UNION ALL
SELECT tenant_id, 'document', id, 'Document', NULL::text, created_at, 'documents'
FROM finnor_os.documents
UNION ALL
SELECT tenant_id, 'domain_action', id, 'Domain action', status::text, created_at, 'domain_actions'
FROM finnor_os.domain_actions
UNION ALL
SELECT tenant_id, 'workflow_run', id, 'Workflow run', status::text, created_at, 'workflow_runs'
FROM finnor_os.workflow_runs
UNION ALL
SELECT tenant_id, 'workflow_step', id, 'Workflow step', status::text, created_at, 'workflow_steps'
FROM finnor_os.workflow_steps
UNION ALL
SELECT tenant_id, 'business_operation', id, 'Business operation', status::text, created_at, 'business_operations'
FROM finnor_os.business_operations
UNION ALL
SELECT tenant_id, 'business_operation_target', id, 'Business operation target', NULL::text, created_at, 'business_operation_targets'
FROM finnor_os.business_operation_targets
UNION ALL
SELECT tenant_id, 'decision_receipt', id, 'Decision receipt', NULL::text, created_at, 'decision_receipts'
FROM finnor_os.decision_receipts
UNION ALL
SELECT tenant_id, 'business_event', id, 'Business event', NULL::text, occurred_at, 'business_events'
FROM finnor_os.business_events;

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'org_units','org_unit_memberships','employee_relationships','party_aliases',
    'external_organizations','external_contacts'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id = finnor_os.request_tenant_id()) WITH CHECK (tenant_id = finnor_os.request_tenant_id())',
      table_name
    );
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.%I TO finnor_app', table_name);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT ON finnor_os.company_graph_edges TO finnor_app;
    GRANT SELECT ON finnor_os.company_graph_nodes TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_party_alias_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.canonical_entity_tenant(text,uuid) TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.normalize_party_text(text) TO finnor_app;
  END IF;
END $rls$;
