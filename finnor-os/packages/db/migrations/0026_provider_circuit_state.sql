-- Phase 4 (§4.4): durable, per-provider circuit-breaker state. Global per provider
-- (a provider's own uptime doesn't vary by tenant), not per-tenant -- per-tenant daily
-- budgets/caps reuse the existing api_rate_limits table instead (bucket_key convention:
-- "budget:<tenantId>:<provider>:<YYYY-MM-DD>"). Deliberately NOT in-memory: capability
-- calls run inside short-lived serverless invocations (Vercel functions, worker job
-- handlers) that don't share process state, so "N consecutive failures" can only mean
-- anything if it's tracked in Postgres.

CREATE TABLE IF NOT EXISTS finnor_os.provider_circuit_state (
  provider text PRIMARY KEY,
  consecutive_failures integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'closed' CHECK (state IN ('closed', 'open')),
  opened_at timestamptz,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.provider_circuit_state TO finnor_app;
  END IF;
END $do$;
