-- B1.T1 — realtime backbone: a single generic trigger function notifies on the
-- 'jarvis_events' channel with IDs only ({tenantId, kind, id, ts}) — never the row
-- payload itself. Listeners (the SSE gateway, apps/worker/src/sse/) relay the id to
-- authz'd clients, who refetch full data through the existing REST APIs they already
-- have tenant-scoped access to. This keeps the trigger cheap (no risk of leaking a
-- row's contents to a channel with no RLS of its own) and keeps NOTIFY's 8000-byte
-- payload ceiling a complete non-issue.
--
-- kind values: 'action_log' | 'workflow_step' | 'dead_letter' | 'domain_action' | 'call'.
-- 'call' rides the same mechanism for B1.T4's durable half (a call finishing and
-- being persisted via persistCall) — the in-progress/ephemeral half (Vapi
-- status-update messages, which have no durable row of their own) is a direct
-- pg_notify from the webhook handler itself, not a trigger, since there is no table
-- write to hang a trigger off for that case.
CREATE OR REPLACE FUNCTION finnor_os.notify_jarvis_event() RETURNS trigger AS $$
DECLARE
  kind text := TG_ARGV[0];
BEGIN
  PERFORM pg_notify('jarvis_events', json_build_object(
    'tenantId', NEW.tenant_id,
    'kind', kind,
    'id', NEW.id,
    'ts', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- action_log is append-only (§10/§19) — insert only, never updated.
DROP TRIGGER IF EXISTS action_log_notify ON finnor_os.action_log;
CREATE TRIGGER action_log_notify
  AFTER INSERT ON finnor_os.action_log
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('action_log');

DROP TRIGGER IF EXISTS workflow_steps_notify ON finnor_os.workflow_steps;
CREATE TRIGGER workflow_steps_notify
  AFTER INSERT OR UPDATE ON finnor_os.workflow_steps
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('workflow_step');

DROP TRIGGER IF EXISTS dead_letters_notify ON finnor_os.dead_letters;
CREATE TRIGGER dead_letters_notify
  AFTER INSERT OR UPDATE ON finnor_os.dead_letters
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('dead_letter');

-- domain_actions(status) per the plan — only fires on insert (initial draft status) or
-- when status itself actually changes, not on every unrelated column touch.
DROP TRIGGER IF EXISTS domain_actions_status_notify ON finnor_os.domain_actions;
CREATE TRIGGER domain_actions_status_notify
  AFTER INSERT OR UPDATE OF status ON finnor_os.domain_actions
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('domain_action');

-- B1.T4 durable half: a call finishing (persistCall's insert) streams to the cockpit
-- the same way everything else does. calls rows are never updated after insert today.
DROP TRIGGER IF EXISTS calls_notify ON finnor_os.calls;
CREATE TRIGGER calls_notify
  AFTER INSERT ON finnor_os.calls
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('call');

-- B1.T3 coverage gap, found while wiring the pipeline-health projection: the plan's
-- own trigger list (action_log/workflow_steps/dead_letters/domain_actions) covers
-- reliability and activity, but NOTHING notifies on the tables pipeline-health is
-- actually computed from (leads/quotes/proposals status). Without this, that
-- projection could only ever go stale under a NOTIFY-driven design. Added here rather
-- than treated as a "changes the design" stop: same generic trigger function, two more
-- tables, same IDs-only shape — an extension of B1.T1's own mechanism, not a new one.
-- proposals is deliberately excluded: it has no tenant_id column of its own (see
-- packages/read-models pipelineHealth()'s own comment — it's scoped via household_id
-- instead), so this generic NEW.tenant_id-reading trigger can't fire on it without a
-- join the trigger function doesn't do. That leg of pipeline-health relies on the
-- periodic rebuild-all backstop (packages/projections) instead of a live NOTIFY.
DROP TRIGGER IF EXISTS leads_notify ON finnor_os.leads;
CREATE TRIGGER leads_notify
  AFTER INSERT OR UPDATE OF status ON finnor_os.leads
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('lead');

DROP TRIGGER IF EXISTS quotes_notify ON finnor_os.quotes;
CREATE TRIGGER quotes_notify
  AFTER INSERT OR UPDATE OF status ON finnor_os.quotes
  FOR EACH ROW EXECUTE FUNCTION finnor_os.notify_jarvis_event('quote');
