-- A2.T4: durable dead-man-switch state for the worker process. Global, not
-- tenant-scoped — same convention as migration 0026's provider_circuit_state (a
-- worker's own liveness doesn't vary by tenant). id is a fixed logical name ("worker")
-- today; B7.T6's fleet-ready worker can widen this to one row per instance later
-- without a shape change (id already supports it).

CREATE TABLE IF NOT EXISTS finnor_os.worker_heartbeat (
  id text PRIMARY KEY,
  last_beat_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'
);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finnor_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON finnor_os.worker_heartbeat TO finnor_app;
  END IF;
END $do$;
