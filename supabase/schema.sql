CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  website text,
  message text,
  status text NOT NULL DEFAULT 'new'
);

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

ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS normalized_domain text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS normalized_company_name text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS profile_json jsonb;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'generated';
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS ip_hash text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS user_agent_hash text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS confidence_score int;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS call_started boolean NOT NULL DEFAULT false;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS call_ended boolean NOT NULL DEFAULT false;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS vapi_call_id text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS source_path text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS referrer text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE public.demo_leads ADD COLUMN IF NOT EXISTS notes jsonb;

ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS normalized_domain text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS normalized_company_name text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS website_url text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS company_name text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS profile_json jsonb;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'generating';
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS ip_hash text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS user_agent_hash text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS account_id text;
ALTER TABLE public.demo_generation_locks ADD COLUMN IF NOT EXISTS browser_fingerprint_hash text;
ALTER TABLE public.demo_generati