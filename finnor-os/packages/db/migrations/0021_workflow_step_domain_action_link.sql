-- Phase 2 (§2.8 finding): decision_receipts.domain_action_id (migration 0016) has never
-- actually been populated — the §2.5 runtime bridge had no way to pass the originating
-- domain_action_id through submitCommand down to the step that opens the receipt.
-- Surfaced by the chaos matrix's AMC-renewal cell (querying a receipt by
-- domain_action_id returned nothing). Denormalized onto workflow_steps, same
-- convention as correlation_id (migration 0018).
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS domain_action_id uuid REFERENCES finnor_os.domain_actions(id);
