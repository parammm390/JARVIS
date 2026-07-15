-- Canonical business data platform (Phase 1, docs/jarvis-90-execution-blueprint.md §1).
-- households remains the de facto customer/account entity (renaming it is out of scope);
-- these tables add the canonical layer around it. All new tables use direct tenant_id
-- RLS (a deliberate deviation from the household-join pattern used by equipment/
-- service_visits/proposals, for consistency across ~20 new tables and to avoid
-- join-subquery RLS policies on potentially high-volume tables like business_events).

ALTER TABLE finnor_os.tenants ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago';
ALTER TABLE finnor_os.proposals ADD COLUMN IF NOT EXISTS quote_id uuid;
ALTER TABLE finnor_os.embeddings ADD COLUMN IF NOT EXISTS document_id uuid;

CREATE TABLE IF NOT EXISTS finnor_os.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid REFERENCES finnor_os.households(id),
  name text NOT NULL,
  role text,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.contact_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  contact_id uuid NOT NULL REFERENCES finnor_os.contacts(id),
  method_type text NOT NULL CHECK (method_type IN ('phone','email','sms')),
  value text NOT NULL,
  consent boolean NOT NULL DEFAULT false,
  consent_recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, method_type, value)
);

CREATE TABLE IF NOT EXISTS finnor_os.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid REFERENCES finnor_os.households(id),
  contact_method_id uuid REFERENCES finnor_os.contact_methods(id),
  name text NOT NULL,
  phone text,
  email text,
  address text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','disqualified','converted')),
  disqualify_reason text,
  source text,
  notes text,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  lead_id uuid REFERENCES finnor_os.leads(id),
  household_id uuid REFERENCES finnor_os.households(id),
  pipeline_stage text NOT NULL DEFAULT 'open' CHECK (pipeline_stage IN ('open','quote_sent','won','lost')),
  expected_value_usd numeric(12,2),
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  title text NOT NULL,
  due_at timestamptz,
  assignee_type text CHECK (assignee_type IN ('user','technician')),
  assignee_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  technician_id uuid REFERENCES finnor_os.technicians(id),
  status text NOT NULL DEFAULT 'hold' CHECK (status IN ('hold','confirmed','completed','canceled','no_show')),
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer,
  hold_expires_at timestamptz,
  notes text,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.technician_capacity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  technician_id uuid NOT NULL REFERENCES finnor_os.technicians(id),
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  start_time text,
  end_time text,
  max_concurrent_jobs integer NOT NULL DEFAULT 1,
  service_radius_miles integer,
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS finnor_os.price_book_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  sku text NOT NULL,
  label text NOT NULL,
  price_usd numeric(12,2) NOT NULL CHECK (price_usd >= 0),
  unit_of_measure text NOT NULL DEFAULT 'each',
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS finnor_os.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid REFERENCES finnor_os.households(id),
  lead_id uuid REFERENCES finnor_os.leads(id),
  opportunity_id uuid REFERENCES finnor_os.opportunities(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','declined','expired')),
  total_usd numeric(12,2),
  valid_until timestamptz,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  quote_id uuid NOT NULL REFERENCES finnor_os.quotes(id),
  sku text,
  label text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_usd numeric(12,2) NOT NULL CHECK (unit_price_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Add the FK now that quotes exists (proposals/quote_id column was added above).
ALTER TABLE finnor_os.proposals
  ADD CONSTRAINT proposals_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES finnor_os.quotes(id);

CREATE TABLE IF NOT EXISTS finnor_os.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid NOT NULL REFERENCES finnor_os.households(id),
  quote_id uuid REFERENCES finnor_os.quotes(id),
  type text NOT NULL CHECK (type IN ('install','repair','warranty','other')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','in_progress','completed','canceled')),
  technician_id uuid REFERENCES finnor_os.technicians(id),
  deposit_amount_usd numeric(12,2),
  stock_reservation jsonb NOT NULL DEFAULT '{}',
  scheduled_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  invoice_id uuid NOT NULL REFERENCES finnor_os.invoices(id),
  amount_usd numeric(12,2) NOT NULL CHECK (amount_usd > 0),
  method text NOT NULL DEFAULT 'other' CHECK (method IN ('card','ach','check','cash','other')),
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('pending','succeeded','failed','refunded')),
  received_at timestamptz NOT NULL DEFAULT now(),
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  name text NOT NULL,
  address text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.warehouse_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  warehouse_id uuid NOT NULL REFERENCES finnor_os.warehouses(id),
  sku text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_of_measure text NOT NULL DEFAULT 'each',
  reorder_threshold integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, sku)
);

CREATE TABLE IF NOT EXISTS finnor_os.procurement_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  warehouse_id uuid NOT NULL REFERENCES finnor_os.warehouses(id),
  sku text NOT NULL,
  quantity_ordered integer NOT NULL CHECK (quantity_ordered > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','received','canceled')),
  expected_at timestamptz,
  received_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid REFERENCES finnor_os.households(id),
  contact_id uuid REFERENCES finnor_os.contacts(id),
  channel text NOT NULL CHECK (channel IN ('voice','sms','email','webchat')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  conversation_id uuid REFERENCES finnor_os.conversations(id),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  from_number text,
  to_number text,
  transcript text,
  recording_url text,
  started_at timestamptz,
  ended_at timestamptz,
  ended_reason text,
  raw jsonb NOT NULL DEFAULT '{}',
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_id)
);

CREATE TABLE IF NOT EXISTS finnor_os.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  conversation_id uuid REFERENCES finnor_os.conversations(id),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel text NOT NULL,
  content text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid REFERENCES finnor_os.households(id),
  kind text NOT NULL,
  title text NOT NULL,
  storage_ref text,
  archived_at timestamptz,
  source_system text,
  external_id text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE finnor_os.embeddings
  ADD CONSTRAINT embeddings_document_id_fkey FOREIGN KEY (document_id) REFERENCES finnor_os.documents(id);

CREATE TABLE IF NOT EXISTS finnor_os.business_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text
);
CREATE INDEX IF NOT EXISTS business_events_entity_idx ON finnor_os.business_events (tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS business_events_type_time_idx ON finnor_os.business_events (tenant_id, event_type, occurred_at);

CREATE TABLE IF NOT EXISTS finnor_os.data_quality_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  finding_type text NOT NULL CHECK (finding_type IN ('duplicate_candidate','missing_critical_field','stale_data','ambiguous_match')),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  related_entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS data_quality_findings_unresolved_idx ON finnor_os.data_quality_findings (tenant_id, resolved_at);

-- RLS: direct tenant_id policy for every new table (deliberate deviation from the
-- household-join pattern for new tables only — see file header comment).
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contacts','contact_methods','leads','opportunities','tasks','appointments',
    'technician_capacity','price_book_items','quotes','quote_line_items','work_orders',
    'payments','warehouses','warehouse_stock','procurement_orders','conversations',
    'calls','messages','documents','business_events','data_quality_findings'
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
