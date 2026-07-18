-- Phase 2 (§2.8, closing the "approval expiry" chaos cell): confirmation_timeout_hours
-- sits next to requires_confirmation/confirmation_template — same convention, a real
-- column, not buried in the policy jsonb. Nullable: unset means the application-level
-- default (24h) applies, not a stored guess.
ALTER TABLE finnor_os.domain_policies ADD COLUMN IF NOT EXISTS confirmation_timeout_hours integer;
