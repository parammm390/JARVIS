-- B2.T2: predictions are stored on the pending domain_action, beside the actual
-- proposed payload but distinct from decision_receipts (which truthfully represent
-- claimed execution steps only). This JSON is immutable planner output; T3 will
-- compare it with the eventual actual receipt.
ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS predicted_receipt jsonb;
