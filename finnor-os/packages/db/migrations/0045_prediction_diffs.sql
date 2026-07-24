-- B2.T3: the immutable prediction stays in predicted_receipt; this separate column
-- records the comparison with the actual execution outcome once it exists.
ALTER TABLE finnor_os.domain_actions
  ADD COLUMN IF NOT EXISTS prediction_diff jsonb;
