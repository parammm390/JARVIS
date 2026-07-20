-- Phase 7 (§7.1/§7.3 — JARVIS 95% MAESTRO PACK): the Approval Inbox now joins
-- decision_receipts by domain_action_id per pending action (apps/api/app/api/actions/
-- pending/route.ts), and the "Why?" view looks receipts up the same way
-- (apps/api/app/api/receipts/route.ts). Both filter on domain_action_id, which had no
-- index (only workflow_step_id, unique, and (tenant_id, created_at) existed) — per
-- engineering law §0.3.6, a new query gets its index in the same commit.
CREATE INDEX IF NOT EXISTS decision_receipts_domain_action_idx
  ON finnor_os.decision_receipts (domain_action_id)
  WHERE domain_action_id IS NOT NULL;
