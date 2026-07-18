-- Phase 2 (§2.6, Temporal exit): the AMC renewal sequence (reminder -> wait -> firmer
-- follow-up -> wait -> escalate) is ported from Temporal's durable timer to a
-- periodically-ticked Postgres scan (apps/worker/src/handlers/scheduled-reminder.ts).
-- These two nullable timestamps are the "wait" state Temporal's workflow held in its
-- own execution history — additive only.
ALTER TABLE finnor_os.maintenance_agreements ADD COLUMN IF NOT EXISTS first_reminder_sent_at timestamptz;
ALTER TABLE finnor_os.maintenance_agreements ADD COLUMN IF NOT EXISTS second_reminder_sent_at timestamptz;
