-- B7.T6: lanes are durable so every worker process sees the same ordering.
ALTER TABLE finnor_os.jobs ADD COLUMN IF NOT EXISTS lane text NOT NULL DEFAULT 'batch' CHECK (lane IN ('interactive','batch'));
ALTER TABLE finnor_os.jobs ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS jobs_lane_priority_run_idx ON finnor_os.jobs (status, lane, priority DESC, run_at);
