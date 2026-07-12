-- marketing_consent is REQUIRED for bulk outreach (TCPA exposure on unconsented
-- promotional calls/texts). Default false: nobody is contactable until consent is recorded.
ALTER TABLE finnor_os.households ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;

-- The dealer owner's phone number, used for outbound voice confirmations when no call
-- is live. Per-tenant data, not an env var.
ALTER TABLE finnor_os.tenants ADD COLUMN IF NOT EXISTS owner_phone text;
