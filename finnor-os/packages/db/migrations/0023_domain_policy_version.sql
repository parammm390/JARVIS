-- Phase 3 (§3.1): decision_receipts.policy_applied already references {id, version}
-- (packages/shared-types) but no policy row has ever carried a real version — every
-- receipt's policyApplied has been hardcoded null since migration 0016. A real integer
-- column, bumped whenever a policy row's config changes, gives receipts something real
-- to cite instead of nothing.
ALTER TABLE finnor_os.domain_policies ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
