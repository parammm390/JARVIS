-- Upgrade 10: Work ownership and employee-authority references must remain in the
-- same tenant even for database owners that can bypass RLS. Foreign keys prove only
-- that a row exists; these triggers prove that the referenced employee, decision,
-- Work, action, operation, and voice identity belong to the row's tenant.

CREATE OR REPLACE FUNCTION finnor_os.assert_employee_ref_tenant(
  p_employee uuid,
  p_tenant uuid,
  p_label text
) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE related_tenant uuid;
BEGIN
  IF p_employee IS NULL THEN RETURN; END IF;
  SELECT tenant_id INTO related_tenant FROM finnor_os.users WHERE id=p_employee;
  IF related_tenant IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION '% crosses tenant boundary or references a missing employee', p_label;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_employee_ref_tenant(uuid,uuid,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finnor_os.assert_upgrade10_employee_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_tenant uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'works' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.created_by,NEW.tenant_id,'Work creator');
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.current_owner_id,NEW.tenant_id,'Work current owner');
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.assigned_to,NEW.tenant_id,'Work assignee');
    WHEN 'work_inputs' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.created_by,NEW.tenant_id,'Work input creator');
      SELECT tenant_id INTO related_tenant FROM finnor_os.works WHERE id=NEW.work_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Work input crosses tenant boundary'; END IF;
    WHEN 'instruction_sessions' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.user_id,NEW.tenant_id,'Instruction employee');
      IF NEW.work_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.works WHERE id=NEW.work_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Instruction Work crosses tenant boundary'; END IF;
      END IF;
    WHEN 'voice_sessions' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.employee_id,NEW.tenant_id,'Voice employee');
      IF NEW.voice_identity_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.voice_identities WHERE id=NEW.voice_identity_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Voice identity crosses tenant boundary'; END IF;
      END IF;
    WHEN 'domain_actions' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.initiated_by,NEW.tenant_id,'Action initiator');
      IF NEW.authority_decision_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.authority_decisions WHERE id=NEW.authority_decision_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Action authority decision crosses tenant boundary'; END IF;
      END IF;
    WHEN 'business_operations' THEN
      IF NEW.authority_decision_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.authority_decisions WHERE id=NEW.authority_decision_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business operation authority decision crosses tenant boundary'; END IF;
      END IF;
    WHEN 'authority_decisions' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.employee_id,NEW.tenant_id,'Authority decision employee');
      IF NEW.approval_chain_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.approval_chains WHERE id=NEW.approval_chain_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Authority decision chain crosses tenant boundary'; END IF;
      END IF;
      IF NEW.work_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.works WHERE id=NEW.work_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Authority decision Work crosses tenant boundary'; END IF;
      END IF;
      IF NEW.domain_action_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Authority decision action crosses tenant boundary'; END IF;
      END IF;
      IF NEW.operation_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.business_operations WHERE id=NEW.operation_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Authority decision operation crosses tenant boundary'; END IF;
      END IF;
    WHEN 'authority_approval_requests' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.requester_id,NEW.tenant_id,'Approval requester');
      SELECT tenant_id INTO related_tenant FROM finnor_os.authority_decisions WHERE id=NEW.authority_decision_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Approval request authority decision crosses tenant boundary'; END IF;
    WHEN 'authority_approval_request_steps' THEN
      PERFORM finnor_os.assert_employee_ref_tenant(NEW.decided_by,NEW.tenant_id,'Approval decider');
      IF NEW.authority_decision_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.authority_decisions WHERE id=NEW.authority_decision_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Approval step authority decision crosses tenant boundary'; END IF;
      END IF;
  END CASE;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_upgrade10_employee_scope() FROM PUBLIC;

DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'works','work_inputs','instruction_sessions','voice_sessions','domain_actions',
    'business_operations','authority_decisions','authority_approval_requests',
    'authority_approval_request_steps'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS upgrade10_employee_scope ON finnor_os.%I',table_name);
    EXECUTE format('CREATE TRIGGER upgrade10_employee_scope BEFORE INSERT OR UPDATE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_upgrade10_employee_scope()',table_name);
  END LOOP;
END $triggers$;

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT EXECUTE ON FUNCTION finnor_os.assert_employee_ref_tenant(uuid,uuid,text),finnor_os.assert_upgrade10_employee_scope() TO finnor_app;
  END IF;
END $grants$;
