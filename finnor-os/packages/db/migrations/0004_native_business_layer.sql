-- Native business layer: Finnor's own database becomes the system of record for
-- inventory and accounting (no external SaaS dependency). RLS like everything else.

CREATE TABLE IF NOT EXISTS finnor_os.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  sku text NOT NULL,
  name text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reorder_threshold integer NOT NULL DEFAULT 0,
  unit_cost_usd numeric,
  UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS finnor_os.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  household_id uuid NOT NULL REFERENCES finnor_os.households(id),
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','void')),
  memo text,
  due_date timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_items','invoices'] LOOP
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
