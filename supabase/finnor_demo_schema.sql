CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.demo_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_domain text,
  normalized_company_name text,
  website_url text,
  company_name text,
  profile_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'generated',
  error_message text,
  ip_hash text,
  user_agent_hash text,
  confidence_score int,
  call_started boolean NOT NULL DEFAULT false,
  call_ended boolean NOT NULL DEFAULT false,
  vapi_call_id text,
  source_path text,
  referrer text,
  user_agent text,
  notes jsonb
);

CREATE TABLE IF NOT EXISTS public.demo_generation_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_domain text NOT NULL,
  normalized_company_name text NOT NULL,
  website_url text,
  company_name text,
  profile_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'generating',
  error_message text,
  ip_hash text,
  user_agent_hash text,
  account_id text,
  browser_fingerprint_hash text,
  lead_id text
);

CREATE INDEX IF NOT EXISTS demo_leads_normalized_domain_idx
  ON public.demo_leads (normalized_domain);

CREATE INDEX IF NOT EXISTS demo_leads_domain_company_idx
  ON public.demo_leads (normalized_domain, normalized_company_name);

CREATE INDEX IF NOT EXISTS demo_generation_locks_normalized_domain_idx
  ON public.demo_generation_locks (normalized_domain);

CREATE INDEX IF NOT EXISTS demo_generation_locks_domain_company_idx
  ON public.demo_generation_locks (normalized_domain, normalized_company_name);

ALTER TABLE public.demo_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_generation_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.demo_leads FROM anon, authenticated;
REVOKE ALL ON TABLE public.demo_generation_locks FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.demo_leads TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.demo_generation_locks TO service_role;
