-- Phase 14 (docs/jarvis-99-phase-10-16-execution-plan.md, "PHASE 14"): resolves which
-- tenant a Vapi call belongs to from the DIALED number, so a multi-tenant deployment
-- routes correctly instead of every call defaulting to VAPI_DEFAULT_TENANT_ID.
--
-- Not tenant-scoped and deliberately has NO RLS policy — same convention as
-- finnor_os.jobs (0000_init.sql): this table is looked up during tenant *resolution*,
-- before tenant_id is known, so a request_tenant_id()-gated RLS policy would make the
-- lookup that establishes tenant_id unable to run at all.
--
-- Uniques are GLOBAL (not per-tenant) on purpose: one dialed number must resolve to
-- exactly one tenant.
CREATE TABLE IF NOT EXISTS finnor_os.tenant_phone_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  phone_number text NOT NULL,
  vapi_phone_number_id text,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone_number),
  UNIQUE (vapi_phone_number_id)
);
