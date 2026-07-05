-- Allow up to 5 demo generations per normalized website domain.
-- Previously a unique index enforced a hard cap of 1 row per domain.

DROP INDEX IF EXISTS public.demo_generation_locks_normalized_domain_key;

CREATE INDEX IF NOT EXISTS demo_generation_locks_normalized_domain_idx
  ON public.demo_generation_locks (normalized_domain);
