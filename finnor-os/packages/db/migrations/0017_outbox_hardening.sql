-- Phase 2 (§2.3): outbox dispatch hardening. Additive only.
-- next_attempt_at: jittered backoff delay, keyed off the classified error kind, so a
-- retryable failure doesn't get reclaimed by the next relay pass before its backoff
-- window elapses. last_error_kind: what the last attempt's failure was classified as
-- (@finnor/shared-types ErrorKind), surfaced for debugging without another join.
ALTER TABLE finnor_os.outbox_events ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE finnor_os.outbox_events ADD COLUMN IF NOT EXISTS last_error_kind text;

-- The claim query's own access path: pending rows for a tenant whose backoff window
-- (if any) has elapsed.
CREATE INDEX IF NOT EXISTS outbox_events_claimable_idx ON finnor_os.outbox_events (tenant_id, status, next_attempt_at);
