-- Upgrade 3: deterministic, typed operational query executions.
--
-- These rows are Work children for observability/idempotency only. They are not
-- planner attempts and do not contain the query result rows or raw conversational
-- content. Result summaries are deliberately bounded so a failed query cannot turn
-- this audit table into an unbounded notes/transcript store.

CREATE TABLE IF NOT EXISTS finnor_os.work_query_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  work_input_id uuid REFERENCES finnor_os.work_inputs(id),
  intent text NOT NULL CHECK (intent IN (
    'customer_lookup', 'customer_cohort', 'schedule_range', 'money_summary',
    'work_list', 'inventory_status', 'agent_activity', 'business_state'
  )),
  request jsonb NOT NULL DEFAULT '{}',
  execution_key text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  result_summary jsonb,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  failure jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (work_id, execution_key),
  CHECK (result_summary IS NULL OR octet_length(result_summary::text) <= 16384),
  CHECK (failure IS NULL OR octet_length(failure::text) <= 8192)
);

CREATE INDEX IF NOT EXISTS work_query_executions_tenant_work_started_idx
  ON finnor_os.work_query_executions (tenant_id, work_id, started_at DESC);
CREATE INDEX IF NOT EXISTS work_query_executions_tenant_status_started_idx
  ON finnor_os.work_query_executions (tenant_id, status, started_at DESC);
CREATE INDEX IF NOT EXISTS work_query_executions_tenant_input_idx
  ON finnor_os.work_query_executions (tenant_id, work_input_id)
  WHERE work_input_id IS NOT NULL;

-- Query-plane source indexes. These follow the actual tenant, foreign-key,
-- time/status and stable keyset predicates in the eight read handlers. They are
-- deliberately additive and idempotent so a deployment can safely rerun this
-- migration after a partial rollout.
CREATE INDEX IF NOT EXISTS households_tenant_created_id_idx
  ON finnor_os.households (tenant_id, created_at, id);
CREATE INDEX IF NOT EXISTS contacts_tenant_household_name_id_idx
  ON finnor_os.contacts (tenant_id, household_id, name, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS contact_methods_tenant_contact_value_idx
  ON finnor_os.contact_methods (tenant_id, contact_id, method_type, value);
CREATE INDEX IF NOT EXISTS conversations_tenant_household_activity_idx
  ON finnor_os.conversations (tenant_id, household_id, last_activity_at DESC, id);
CREATE INDEX IF NOT EXISTS messages_tenant_conversation_sent_idx
  ON finnor_os.messages (tenant_id, conversation_id, sent_at DESC, id);
CREATE INDEX IF NOT EXISTS communications_household_timestamp_id_idx
  ON finnor_os.communications_log (household_id, timestamp DESC, id);
CREATE INDEX IF NOT EXISTS service_visits_household_scheduled_id_idx
  ON finnor_os.service_visits (household_id, scheduled_at, id);
CREATE INDEX IF NOT EXISTS service_visits_household_completed_id_idx
  ON finnor_os.service_visits (household_id, completed_at, id);
CREATE INDEX IF NOT EXISTS appointments_tenant_scheduled_id_idx
  ON finnor_os.appointments (tenant_id, scheduled_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_tenant_scheduled_id_idx
  ON finnor_os.work_orders (tenant_id, scheduled_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS work_orders_tenant_status_created_id_idx
  ON finnor_os.work_orders (tenant_id, status, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_tenant_created_id_idx
  ON finnor_os.tasks (tenant_id, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS tasks_tenant_status_created_id_idx
  ON finnor_os.tasks (tenant_id, status, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_tenant_status_created_id_idx
  ON finnor_os.leads (tenant_id, status, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS leads_tenant_household_idx
  ON finnor_os.leads (tenant_id, household_id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS quotes_tenant_status_created_id_idx
  ON finnor_os.quotes (tenant_id, status, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS proposals_household_status_id_idx
  ON finnor_os.proposals (household_id, status, id);
CREATE INDEX IF NOT EXISTS opportunities_tenant_stage_created_id_idx
  ON finnor_os.opportunities (tenant_id, pipeline_stage, created_at, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS invoices_tenant_status_created_id_idx
  ON finnor_os.invoices (tenant_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS invoices_tenant_household_created_id_idx
  ON finnor_os.invoices (tenant_id, household_id, created_at, id);
CREATE INDEX IF NOT EXISTS payments_tenant_status_received_id_idx
  ON finnor_os.payments (tenant_id, status, received_at, id);
CREATE INDEX IF NOT EXISTS payments_tenant_invoice_received_id_idx
  ON finnor_os.payments (tenant_id, invoice_id, received_at, id);
CREATE INDEX IF NOT EXISTS works_tenant_updated_id_idx
  ON finnor_os.works (tenant_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS works_tenant_status_updated_id_idx
  ON finnor_os.works (tenant_id, status, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS work_inputs_tenant_work_created_id_idx
  ON finnor_os.work_inputs (tenant_id, work_id, created_at, id);
CREATE INDEX IF NOT EXISTS users_tenant_created_id_idx
  ON finnor_os.users (tenant_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS technicians_tenant_name_id_idx
  ON finnor_os.technicians (tenant_id, name, id);
CREATE INDEX IF NOT EXISTS action_log_tenant_timestamp_id_idx
  ON finnor_os.action_log (tenant_id, timestamp DESC, id);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_updated_id_idx
  ON finnor_os.workflow_runs (tenant_id, updated_at DESC, id);
CREATE INDEX IF NOT EXISTS calls_tenant_started_created_id_idx
  ON finnor_os.calls (tenant_id, started_at DESC, created_at DESC, id);
CREATE INDEX IF NOT EXISTS calls_tenant_created_id_idx
  ON finnor_os.calls (tenant_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS inventory_items_tenant_sku_id_idx
  ON finnor_os.inventory_items (tenant_id, sku, id);
CREATE INDEX IF NOT EXISTS inventory_items_tenant_quantity_id_idx
  ON finnor_os.inventory_items (tenant_id, quantity, id);
CREATE INDEX IF NOT EXISTS warehouses_tenant_id_idx
  ON finnor_os.warehouses (tenant_id, id);
CREATE INDEX IF NOT EXISTS warehouse_stock_tenant_sku_id_idx
  ON finnor_os.warehouse_stock (tenant_id, sku, id);
CREATE INDEX IF NOT EXISTS warehouse_stock_tenant_id_idx
  ON finnor_os.warehouse_stock (tenant_id, id);
CREATE INDEX IF NOT EXISTS procurement_orders_tenant_status_created_id_idx
  ON finnor_os.procurement_orders (tenant_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS procurement_orders_tenant_sku_status_id_idx
  ON finnor_os.procurement_orders (tenant_id, sku, status, id);

-- The parent FKs guarantee existence; this trigger also guarantees that a caller
-- cannot attach a row from one tenant's Work/Input pair to another tenant id.
CREATE OR REPLACE FUNCTION finnor_os.assert_work_query_execution_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  work_tenant uuid;
  input_tenant uuid;
  input_work uuid;
BEGIN
  SELECT tenant_id INTO work_tenant
  FROM finnor_os.works
  WHERE id = NEW.work_id;
  IF work_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'work query execution Work does not belong to tenant';
  END IF;

  IF NEW.work_input_id IS NOT NULL THEN
    SELECT tenant_id, work_id INTO input_tenant, input_work
    FROM finnor_os.work_inputs
    WHERE id = NEW.work_input_id;
    IF input_tenant IS DISTINCT FROM NEW.tenant_id OR input_work IS DISTINCT FROM NEW.work_id THEN
      RAISE EXCEPTION 'work query execution input does not belong to Work and tenant';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS work_query_executions_scope ON finnor_os.work_query_executions;
CREATE TRIGGER work_query_executions_scope
  BEFORE INSERT OR UPDATE ON finnor_os.work_query_executions
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_work_query_execution_scope();

-- Trigger functions are invoked by the trigger, not exposed as a general app
-- callable. Keep the default PUBLIC execute privilege revoked while granting the
-- minimum privilege needed for the trigger owner/application role.
REVOKE EXECUTE ON FUNCTION finnor_os.assert_work_query_execution_scope() FROM PUBLIC;

ALTER TABLE finnor_os.work_query_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.work_query_executions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.work_query_executions;
CREATE POLICY tenant_isolation ON finnor_os.work_query_executions
  USING (tenant_id = finnor_os.request_tenant_id())
  WITH CHECK (tenant_id = finnor_os.request_tenant_id());

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE ON finnor_os.work_query_executions TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_work_query_execution_scope() TO finnor_app;
    REVOKE DELETE ON finnor_os.work_query_executions FROM finnor_app;
  END IF;
END $do$;
