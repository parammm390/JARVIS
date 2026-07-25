-- D6.T4: this is an interaction marker, not an activity event. It is updated only
-- after the caller has received their own digest, so the next digest has a real,
-- bounded comparison window.
ALTER TABLE finnor_os.user_prefs ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
