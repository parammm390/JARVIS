-- Phase 3 Execution Theater: persist exact provider provenance at the two existing
-- execution ledgers and extend Phase 2's OperationalDelta coverage to execution facts
-- that previously changed without invalidating a selected Work projection.
-- No lifecycle, event bus, or canonical execution table is introduced here.

ALTER TABLE finnor_os.external_operations ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE finnor_os.integration_operations ADD COLUMN IF NOT EXISTS provider text;

COMMENT ON COLUMN finnor_os.external_operations.provider IS
  'Exact ToolRegistry integration selected for this execution attempt; null on historical rows.';
COMMENT ON COLUMN finnor_os.integration_operations.provider IS
  'Exact CapabilityBinding.name selected for this execution attempt; null on historical rows.';

-- Some execution child tables do not carry work_id directly. Resolve that durable
-- edge inside the trigger, then append to the existing Phase 2 ledger using the same
-- IDs-only envelope and jarvis_events NOTIFY channel.
CREATE OR REPLACE FUNCTION finnor_os.append_execution_operational_delta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE
  tenant uuid := (to_jsonb(NEW)->>'tenant_id')::uuid;
  row_id uuid := NULL;
  work uuid := NULL;
  step uuid := NULL;
  next_seq bigint;
  priority_value text := 'normal';
  status_value text := coalesce(to_jsonb(NEW)->>'status','');
  refs jsonb := '[]'::jsonb;
  tags text[] := string_to_array(TG_ARGV[1],',');
BEGIN
  IF tenant IS NULL THEN RAISE EXCEPTION 'execution delta source has no tenant'; END IF;

  BEGIN row_id := nullif(to_jsonb(NEW)->>'id','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN row_id := NULL; END;

  CASE TG_TABLE_NAME
    WHEN 'computer_steps' THEN
      SELECT r.work_id INTO work FROM finnor_os.computer_runs r
        WHERE r.tenant_id=tenant AND r.id=(to_jsonb(NEW)->>'run_id')::uuid;
    WHEN 'computer_artifacts' THEN
      SELECT r.work_id INTO work FROM finnor_os.computer_runs r
        WHERE r.tenant_id=tenant AND r.id=(to_jsonb(NEW)->>'run_id')::uuid;
    WHEN 'authority_decisions' THEN
      work := nullif(to_jsonb(NEW)->>'work_id','')::uuid;
      IF work IS NULL AND nullif(to_jsonb(NEW)->>'domain_action_id','') IS NOT NULL THEN
        SELECT a.work_id INTO work FROM finnor_os.domain_actions a
          WHERE a.tenant_id=tenant AND a.id=(to_jsonb(NEW)->>'domain_action_id')::uuid;
      END IF;
    WHEN 'authority_approval_request_steps' THEN
      SELECT a.work_id INTO work
        FROM finnor_os.authority_approval_requests q
        JOIN finnor_os.domain_actions a ON a.id=q.domain_action_id AND a.tenant_id=q.tenant_id
       WHERE q.tenant_id=tenant AND q.id=(to_jsonb(NEW)->>'approval_request_id')::uuid;
    WHEN 'integration_operations' THEN
      step := (to_jsonb(NEW)->>'workflow_step_id')::uuid;
      SELECT r.work_id INTO work FROM finnor_os.workflow_steps s
        JOIN finnor_os.workflow_runs r ON r.id=s.workflow_run_id AND r.tenant_id=s.tenant_id
       WHERE s.tenant_id=tenant AND s.id=step;
    WHEN 'external_operations' THEN
      SELECT a.work_id INTO work FROM finnor_os.domain_actions a
       WHERE a.tenant_id=tenant AND a.id=(to_jsonb(NEW)->>'domain_action_id')::uuid;
    WHEN 'reconciliation_cases' THEN
      step := nullif(to_jsonb(NEW)->>'related_step_id','')::uuid;
      IF step IS NULL AND nullif(to_jsonb(NEW)->>'related_outbox_event_id','') IS NOT NULL THEN
        SELECT o.workflow_step_id INTO step FROM finnor_os.outbox_events o
         WHERE o.tenant_id=tenant AND o.id=(to_jsonb(NEW)->>'related_outbox_event_id')::uuid;
      END IF;
      IF step IS NULL AND nullif(to_jsonb(NEW)->>'related_inbox_event_id','') IS NOT NULL THEN
        SELECT i.matched_step_id INTO step FROM finnor_os.inbox_events i
         WHERE i.tenant_id=tenant AND i.id=(to_jsonb(NEW)->>'related_inbox_event_id')::uuid;
      END IF;
      IF step IS NOT NULL THEN
        SELECT r.work_id INTO work FROM finnor_os.workflow_steps s
          JOIN finnor_os.workflow_runs r ON r.id=s.workflow_run_id AND r.tenant_id=s.tenant_id
         WHERE s.tenant_id=tenant AND s.id=step;
      END IF;
    WHEN 'compensation_cases' THEN
      step := (to_jsonb(NEW)->>'workflow_step_id')::uuid;
      SELECT r.work_id INTO work FROM finnor_os.workflow_steps s
        JOIN finnor_os.workflow_runs r ON r.id=s.workflow_run_id AND r.tenant_id=s.tenant_id
       WHERE s.tenant_id=tenant AND s.id=step;
    WHEN 'communication_deliveries' THEN
      work := nullif(to_jsonb(NEW)->>'work_id','')::uuid;
      IF work IS NULL THEN
        SELECT a.work_id INTO work FROM finnor_os.domain_actions a
         WHERE a.tenant_id=tenant AND a.id=(to_jsonb(NEW)->>'domain_action_id')::uuid;
      END IF;
    WHEN 'outbox_events' THEN
      step := nullif(to_jsonb(NEW)->>'workflow_step_id','')::uuid;
      IF step IS NOT NULL THEN
        SELECT r.work_id INTO work FROM finnor_os.workflow_steps s
          JOIN finnor_os.workflow_runs r ON r.id=s.workflow_run_id AND r.tenant_id=s.tenant_id
         WHERE s.tenant_id=tenant AND s.id=step;
      END IF;
  END CASE;

  IF row_id IS NOT NULL AND coalesce(TG_ARGV[0],'')<>'' THEN
    refs := jsonb_build_array(jsonb_build_object('entityType',TG_ARGV[0],'entityId',row_id));
  END IF;
  IF status_value IN ('pending','blocked','failed','unknown','open','needs_human_review') THEN
    priority_value := 'high';
  END IF;

  INSERT INTO finnor_os.tenant_operational_delta_cursors(tenant_id,last_seq)
  VALUES (tenant,1)
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_seq=finnor_os.tenant_operational_delta_cursors.last_seq+1,updated_at=now()
  RETURNING last_seq INTO next_seq;

  INSERT INTO finnor_os.operational_deltas(
    tenant_id,seq,change_type,priority,entity_refs,work_id,projection_tags
  ) VALUES (
    tenant,next_seq,TG_TABLE_NAME||'.'||lower(TG_OP),priority_value,refs,work,tags
  );

  PERFORM pg_notify('jarvis_events',json_build_object(
    'tenantId',tenant,'kind','operational_delta','id',next_seq::text,
    'ts',to_char(now() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )::text);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.append_execution_operational_delta() FROM PUBLIC;

DROP TRIGGER IF EXISTS computer_steps_operational_delta ON finnor_os.computer_steps;
CREATE TRIGGER computer_steps_operational_delta AFTER INSERT OR UPDATE OF status,phase ON finnor_os.computer_steps
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('computer_step','computer,work,actions,receipts,activity,queries');
DROP TRIGGER IF EXISTS computer_artifacts_operational_delta ON finnor_os.computer_artifacts;
CREATE TRIGGER computer_artifacts_operational_delta AFTER INSERT ON finnor_os.computer_artifacts
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('computer_artifact','computer,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS authority_decisions_execution_delta ON finnor_os.authority_decisions;
CREATE TRIGGER authority_decisions_execution_delta AFTER INSERT ON finnor_os.authority_decisions
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','approvals,actions,work,activity');
DROP TRIGGER IF EXISTS authority_approval_steps_execution_delta ON finnor_os.authority_approval_request_steps;
CREATE TRIGGER authority_approval_steps_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.authority_approval_request_steps
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','approvals,actions,work,activity');
DROP TRIGGER IF EXISTS integration_operations_execution_delta ON finnor_os.integration_operations;
CREATE TRIGGER integration_operations_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.integration_operations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','workflows,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS external_operations_execution_delta ON finnor_os.external_operations;
CREATE TRIGGER external_operations_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.external_operations
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','workflows,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS reconciliation_cases_execution_delta ON finnor_os.reconciliation_cases;
CREATE TRIGGER reconciliation_cases_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.reconciliation_cases
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','workflows,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS compensation_cases_execution_delta ON finnor_os.compensation_cases;
CREATE TRIGGER compensation_cases_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.compensation_cases
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','workflows,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS communication_deliveries_execution_delta ON finnor_os.communication_deliveries;
CREATE TRIGGER communication_deliveries_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.communication_deliveries
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('communication_delivery','comms,work,actions,receipts,activity');
DROP TRIGGER IF EXISTS outbox_events_execution_delta ON finnor_os.outbox_events;
CREATE TRIGGER outbox_events_execution_delta AFTER INSERT OR UPDATE OF status ON finnor_os.outbox_events
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_execution_operational_delta('','workflows,work,actions,receipts,activity');
