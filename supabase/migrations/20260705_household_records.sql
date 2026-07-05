-- One spine for every demo: each lead becomes a household memory record with
-- a computed next revenue action and a running LTV. Written by
-- /api/generate-demo (call demo, month zero), /api/demo/extract-intake
-- (post-call merge), and /api/lifecycle/diagnose (two-year projection).

CREATE TABLE IF NOT EXISTS public.household_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  dealer_name text,
  service_zip text,
  pricing_tier text,
  stage text NOT NULL DEFAULT 'lead',
  ltv numeric NOT NULL DEFAULT 0,
  next_action jsonb,
  record jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS household_records_source_idx ON public.household_records (source);
CREATE INDEX IF NOT EXISTS household_records_zip_idx ON public.household_records (service_zip);

ALTER TABLE public.household_records ENABLE ROW LEVEL SECURITY;
-- Service-role key only; no anon policies on purpose.
