-- Upgrade 8: JARVIS employee identity + authority runtime.
--
-- `users` remains the canonical employee identity. The additive model below adds
-- multiple roles, scoped grants, financial/risk ceilings, data-driven approval
-- chains and an immutable decision ledger. Legacy roles and role_permissions are
-- continuously mirrored so existing owner/dispatcher/technician behavior survives
-- rollout while all new execution paths use one authority evaluator.

ALTER TABLE finnor_os.users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE finnor_os.users ADD COLUMN IF NOT EXISTS phone_number text;
ALTER TABLE finnor_os.users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','suspended'));
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_phone_idx
  ON finnor_os.users(tenant_id, phone_number) WHERE phone_number IS NOT NULL;
-- Historical/dev tenants can contain more than one legacy owner. A phone number is
-- an employee identity, so backfill the tenant phone onto exactly one deterministic
-- owner instead of assigning the same identity to every owner row.
UPDATE finnor_os.users u SET phone_number=t.owner_phone
FROM finnor_os.tenants t
WHERE u.id=(
  SELECT candidate.id FROM finnor_os.users candidate
  WHERE candidate.tenant_id=t.id AND candidate.role='owner' AND candidate.phone_number IS NULL
  ORDER BY candidate.created_at,candidate.id LIMIT 1
)
AND t.owner_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.authority_states (
  tenant_id uuid PRIMARY KEY REFERENCES finnor_os.tenants(id),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finnor_os.employee_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  description text,
  legacy_role text CHECK (legacy_role IS NULL OR legacy_role IN ('owner','dispatcher','technician')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS finnor_os.approval_chains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS finnor_os.approval_chain_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  approval_chain_id uuid NOT NULL REFERENCES finnor_os.approval_chains(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  approver_capability text NOT NULL DEFAULT 'approve:$action',
  -- Upgrade 8 intentionally implements sequential single-approver steps. Reject
  -- unsupported quorum configuration instead of silently enforcing it incorrectly.
  min_approvals integer NOT NULL DEFAULT 1 CHECK (min_approvals = 1),
  UNIQUE (approval_chain_id, sequence)
);

CREATE TABLE IF NOT EXISTS finnor_os.employee_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  employee_id uuid NOT NULL REFERENCES finnor_os.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES finnor_os.employee_roles(id),
  resource_scope jsonb NOT NULL DEFAULT '{"kind":"tenant"}',
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, role_id),
  CHECK (resource_scope ? 'kind'),
  CHECK (resource_scope->>'kind' IN ('tenant','resources','assigned','self'))
);
CREATE INDEX IF NOT EXISTS employee_role_assignments_tenant_employee_idx
  ON finnor_os.employee_role_assignments(tenant_id, employee_id);

CREATE TABLE IF NOT EXISTS finnor_os.role_authority_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  role_id uuid NOT NULL REFERENCES finnor_os.employee_roles(id),
  capability text NOT NULL,
  resource_type text NOT NULL DEFAULT '*',
  effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow','deny')),
  max_amount_usd numeric(14,2) CHECK (max_amount_usd IS NULL OR max_amount_usd >= 0),
  max_risk text NOT NULL DEFAULT 'high' CHECK (max_risk IN ('low','medium','high')),
  approval_required boolean NOT NULL DEFAULT false,
  approval_chain_id uuid REFERENCES finnor_os.approval_chains(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, capability, resource_type)
);
CREATE INDEX IF NOT EXISTS role_authority_grants_tenant_capability_idx
  ON finnor_os.role_authority_grants(tenant_id, capability);

CREATE TABLE IF NOT EXISTS finnor_os.authority_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  employee_id uuid REFERENCES finnor_os.users(id),
  authority_revision integer NOT NULL,
  operation text NOT NULL CHECK (operation IN ('query','action','approval','execution','durable_operation')),
  capability text NOT NULL,
  resource_type text NOT NULL DEFAULT '*',
  resource_id uuid,
  amount_usd numeric(14,2),
  risk text NOT NULL CHECK (risk IN ('low','medium','high')),
  outcome text NOT NULL CHECK (outcome IN ('allowed','denied','approval_required')),
  reason_code text NOT NULL,
  approval_chain_id uuid REFERENCES finnor_os.approval_chains(id),
  evidence jsonb NOT NULL DEFAULT '{}',
  work_id uuid,
  domain_action_id uuid,
  operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS authority_decisions_tenant_employee_idx
  ON finnor_os.authority_decisions(tenant_id, employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS authority_decisions_action_idx
  ON finnor_os.authority_decisions(domain_action_id) WHERE domain_action_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finnor_os.authority_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid NOT NULL,
  requester_id uuid REFERENCES finnor_os.users(id),
  authority_decision_id uuid NOT NULL REFERENCES finnor_os.authority_decisions(id),
  approval_chain_id uuid NOT NULL REFERENCES finnor_os.approval_chains(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  current_step integer NOT NULL DEFAULT 1 CHECK (current_step > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (domain_action_id)
);
CREATE INDEX IF NOT EXISTS authority_approval_requests_tenant_status_idx
  ON finnor_os.authority_approval_requests(tenant_id, status);

CREATE TABLE IF NOT EXISTS finnor_os.authority_approval_request_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  approval_request_id uuid NOT NULL REFERENCES finnor_os.authority_approval_requests(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  approver_capability text NOT NULL,
  min_approvals integer NOT NULL DEFAULT 1 CHECK (min_approvals > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','skipped')),
  decided_by uuid REFERENCES finnor_os.users(id),
  authority_decision_id uuid REFERENCES finnor_os.authority_decisions(id),
  decided_at timestamptz,
  UNIQUE (approval_request_id, sequence)
);

ALTER TABLE finnor_os.works ADD COLUMN IF NOT EXISTS current_owner_id uuid REFERENCES finnor_os.users(id);
ALTER TABLE finnor_os.works ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES finnor_os.users(id);
ALTER TABLE finnor_os.works ADD COLUMN IF NOT EXISTS authority_context jsonb NOT NULL DEFAULT '{}';
UPDATE finnor_os.works SET current_owner_id=created_by WHERE current_owner_id IS NULL AND created_by IS NOT NULL;

ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS initiated_by uuid REFERENCES finnor_os.users(id);
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS authority_decision_id uuid REFERENCES finnor_os.authority_decisions(id);
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS authority_revision integer;
ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS authority_context jsonb NOT NULL DEFAULT '{}';
UPDATE finnor_os.domain_actions a SET initiated_by=w.created_by
FROM finnor_os.works w WHERE a.work_id=w.id AND a.initiated_by IS NULL;

ALTER TABLE finnor_os.business_operations ADD COLUMN IF NOT EXISTS authority_decision_id uuid REFERENCES finnor_os.authority_decisions(id);
ALTER TABLE finnor_os.business_operations ADD COLUMN IF NOT EXISTS authority_revision integer;

ALTER TABLE finnor_os.voice_sessions ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES finnor_os.users(id);
ALTER TABLE finnor_os.voice_sessions ADD COLUMN IF NOT EXISTS authority_context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE finnor_os.instruction_sessions ADD COLUMN IF NOT EXISTS authority_context jsonb NOT NULL DEFAULT '{}';

ALTER TABLE finnor_os.authority_decisions
  ADD CONSTRAINT authority_decisions_work_fk FOREIGN KEY (work_id) REFERENCES finnor_os.works(id);
ALTER TABLE finnor_os.authority_decisions
  ADD CONSTRAINT authority_decisions_action_fk FOREIGN KEY (domain_action_id) REFERENCES finnor_os.domain_actions(id);
ALTER TABLE finnor_os.authority_decisions
  ADD CONSTRAINT authority_decisions_operation_fk FOREIGN KEY (operation_id) REFERENCES finnor_os.business_operations(id);
ALTER TABLE finnor_os.authority_approval_requests
  ADD CONSTRAINT authority_approval_requests_action_fk FOREIGN KEY (domain_action_id) REFERENCES finnor_os.domain_actions(id);

-- Tenant-crossing foreign keys are rejected even for a table owner/superuser.
CREATE OR REPLACE FUNCTION finnor_os.assert_authority_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE related_tenant uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'employee_role_assignments' THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.users WHERE id=NEW.employee_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'employee authority assignment crosses tenant boundary'; END IF;
      SELECT tenant_id INTO related_tenant FROM finnor_os.employee_roles WHERE id=NEW.role_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'employee authority role crosses tenant boundary'; END IF;
    WHEN 'role_authority_grants' THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.employee_roles WHERE id=NEW.role_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'authority grant role crosses tenant boundary'; END IF;
      IF NEW.approval_chain_id IS NOT NULL THEN
        SELECT tenant_id INTO related_tenant FROM finnor_os.approval_chains WHERE id=NEW.approval_chain_id;
        IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'authority grant chain crosses tenant boundary'; END IF;
      END IF;
    WHEN 'approval_chain_steps' THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.approval_chains WHERE id=NEW.approval_chain_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'approval chain step crosses tenant boundary'; END IF;
    WHEN 'authority_approval_requests' THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.domain_actions WHERE id=NEW.domain_action_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'authority approval request action crosses tenant boundary'; END IF;
      SELECT tenant_id INTO related_tenant FROM finnor_os.approval_chains WHERE id=NEW.approval_chain_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'authority approval request chain crosses tenant boundary'; END IF;
    WHEN 'authority_approval_request_steps' THEN
      SELECT tenant_id INTO related_tenant FROM finnor_os.authority_approval_requests WHERE id=NEW.approval_request_id;
      IF related_tenant IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'authority approval step crosses tenant boundary'; END IF;
  END CASE;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION finnor_os.assert_authority_scope() FROM PUBLIC;

DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['employee_role_assignments','role_authority_grants','approval_chain_steps','authority_approval_requests','authority_approval_request_steps'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS authority_scope ON finnor_os.%I', table_name);
    EXECUTE format('CREATE TRIGGER authority_scope BEFORE INSERT OR UPDATE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_authority_scope()', table_name);
  END LOOP;
END $triggers$;

-- One default capability-based chain per tenant. It routes to whoever currently has
-- approve:<action>, so adding a finance manager role requires no route code change.
CREATE OR REPLACE FUNCTION finnor_os.ensure_legacy_authority(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE chain_id uuid; role_name text; selected_role_id uuid;
BEGIN
  INSERT INTO finnor_os.authority_states(tenant_id) VALUES (p_tenant) ON CONFLICT DO NOTHING;
  INSERT INTO finnor_os.approval_chains(tenant_id,key,name) VALUES (p_tenant,'default','Authorized employee approval')
    ON CONFLICT (tenant_id,key) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO chain_id;
  IF chain_id IS NULL THEN SELECT id INTO chain_id FROM finnor_os.approval_chains WHERE tenant_id=p_tenant AND key='default'; END IF;
  INSERT INTO finnor_os.approval_chain_steps(tenant_id,approval_chain_id,sequence,approver_capability,min_approvals)
    VALUES (p_tenant,chain_id,1,'approve:$action',1) ON CONFLICT (approval_chain_id,sequence) DO NOTHING;
  FOREACH role_name IN ARRAY ARRAY['owner','dispatcher','technician'] LOOP
    INSERT INTO finnor_os.employee_roles(tenant_id,key,name,legacy_role)
      VALUES (p_tenant,role_name,initcap(role_name),role_name)
      ON CONFLICT (tenant_id,key) DO UPDATE SET legacy_role=EXCLUDED.legacy_role,active=true RETURNING id INTO selected_role_id;
    IF selected_role_id IS NULL THEN SELECT id INTO selected_role_id FROM finnor_os.employee_roles WHERE tenant_id=p_tenant AND key=role_name; END IF;
    INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk,approval_chain_id)
      VALUES (p_tenant,selected_role_id,'action:*','*','allow','high',chain_id)
      ON CONFLICT (role_id,capability,resource_type) DO NOTHING;
    INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
      VALUES (p_tenant,selected_role_id,'query:*','*','allow','high')
      ON CONFLICT (role_id,capability,resource_type) DO NOTHING;
    IF role_name='owner' THEN
      INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
        VALUES (p_tenant,selected_role_id,'approve:*','*','allow','high')
        ON CONFLICT (role_id,capability,resource_type) DO NOTHING;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION finnor_os.ensure_legacy_authority(uuid) FROM PUBLIC;

SELECT finnor_os.ensure_legacy_authority(id) FROM finnor_os.tenants;

INSERT INTO finnor_os.employee_role_assignments(tenant_id,employee_id,role_id,resource_scope)
SELECT u.tenant_id,u.id,r.id,'{"kind":"tenant"}'::jsonb
FROM finnor_os.users u JOIN finnor_os.employee_roles r ON r.tenant_id=u.tenant_id AND r.legacy_role=u.role
ON CONFLICT (employee_id,role_id) DO UPDATE SET active=true;

-- Existing RBAC rows become approval capabilities. No hard-coded role check remains
-- in the runtime; future functional roles can receive the same capability directly.
INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
SELECT DISTINCT rp.tenant_id,r.id,'approve:'||rp.action_type,'*','allow','high'
FROM finnor_os.role_permissions rp
JOIN finnor_os.employee_roles r ON r.tenant_id=rp.tenant_id AND r.legacy_role=rp.role
WHERE rp.can_approve
ON CONFLICT (role_id,capability,resource_type) DO UPDATE SET effect='allow';
-- Preserve the prior safe owner fallback even for tenants with no role_permissions.
INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
SELECT tenant_id,id,'approve:*','*','allow','high' FROM finnor_os.employee_roles WHERE legacy_role='owner'
ON CONFLICT (role_id,capability,resource_type) DO NOTHING;

CREATE OR REPLACE FUNCTION finnor_os.sync_user_legacy_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE selected_role uuid;
BEGIN
  PERFORM finnor_os.ensure_legacy_authority(NEW.tenant_id);
  SELECT id INTO selected_role FROM finnor_os.employee_roles WHERE tenant_id=NEW.tenant_id AND legacy_role=NEW.role;
  UPDATE finnor_os.employee_role_assignments a SET active=false
    FROM finnor_os.employee_roles r WHERE a.employee_id=NEW.id AND a.role_id=r.id AND r.legacy_role IS NOT NULL AND r.id<>selected_role;
  INSERT INTO finnor_os.employee_role_assignments(tenant_id,employee_id,role_id,resource_scope,active)
    VALUES (NEW.tenant_id,NEW.id,selected_role,'{"kind":"tenant"}'::jsonb,true)
    ON CONFLICT (employee_id,role_id) DO UPDATE SET active=true,expires_at=NULL;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS users_sync_legacy_authority ON finnor_os.users;
CREATE TRIGGER users_sync_legacy_authority AFTER INSERT OR UPDATE OF role ON finnor_os.users
FOR EACH ROW EXECUTE FUNCTION finnor_os.sync_user_legacy_authority();

CREATE OR REPLACE FUNCTION finnor_os.sync_role_permission_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE source_tenant uuid; source_role text; source_action text; source_allowed boolean; selected_role uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    source_tenant:=OLD.tenant_id; source_role:=OLD.role; source_action:=OLD.action_type; source_allowed:=false;
  ELSE
    source_tenant:=NEW.tenant_id; source_role:=NEW.role; source_action:=NEW.action_type; source_allowed:=NEW.can_approve;
  END IF;
  PERFORM finnor_os.ensure_legacy_authority(source_tenant);
  SELECT id INTO selected_role FROM finnor_os.employee_roles WHERE tenant_id=source_tenant AND legacy_role=source_role;
  IF source_allowed THEN
    INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
      VALUES (source_tenant,selected_role,'approve:'||source_action,'*','allow','high')
      ON CONFLICT (role_id,capability,resource_type) DO UPDATE SET effect='allow',updated_at=now();
  ELSIF NOT (source_role='owner' AND source_action='*') THEN
    DELETE FROM finnor_os.role_authority_grants WHERE role_id=selected_role AND capability='approve:'||source_action AND resource_type='*';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS role_permissions_sync_authority ON finnor_os.role_permissions;
CREATE TRIGGER role_permissions_sync_authority AFTER INSERT OR UPDATE OR DELETE ON finnor_os.role_permissions
FOR EACH ROW EXECUTE FUNCTION finnor_os.sync_role_permission_authority();

CREATE OR REPLACE FUNCTION finnor_os.bump_authority_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE affected_tenant uuid;
BEGIN
  IF TG_OP='DELETE' THEN affected_tenant:=OLD.tenant_id; ELSE affected_tenant:=NEW.tenant_id; END IF;
  INSERT INTO finnor_os.authority_states(tenant_id,revision,updated_at) VALUES (affected_tenant,2,now())
  ON CONFLICT (tenant_id) DO UPDATE SET revision=finnor_os.authority_states.revision+1,updated_at=now();
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DO $revision_triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['employee_roles','employee_role_assignments','role_authority_grants','approval_chains','approval_chain_steps'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS authority_revision ON finnor_os.%I', table_name);
    EXECUTE format('CREATE TRIGGER authority_revision AFTER INSERT OR UPDATE OR DELETE ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.bump_authority_revision()', table_name);
  END LOOP;
END $revision_triggers$;
DROP TRIGGER IF EXISTS users_authority_revision ON finnor_os.users;
CREATE TRIGGER users_authority_revision AFTER UPDATE OF status ON finnor_os.users
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION finnor_os.bump_authority_revision();

-- Decisions are audit evidence and can never be rewritten or deleted.
DROP TRIGGER IF EXISTS authority_decisions_immutable ON finnor_os.authority_decisions;
CREATE TRIGGER authority_decisions_immutable BEFORE UPDATE OR DELETE ON finnor_os.authority_decisions
FOR EACH ROW EXECUTE FUNCTION finnor_os.forbid_mutation();

DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'authority_states','employee_roles','approval_chains','approval_chain_steps',
    'employee_role_assignments','role_authority_grants','authority_decisions',
    'authority_approval_requests','authority_approval_request_steps'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.authority_states,finnor_os.employee_roles,finnor_os.approval_chains,finnor_os.approval_chain_steps,finnor_os.employee_role_assignments,finnor_os.role_authority_grants,finnor_os.authority_approval_requests,finnor_os.authority_approval_request_steps TO finnor_app;
    GRANT SELECT,INSERT ON finnor_os.authority_decisions TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_authority_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.ensure_legacy_authority(uuid) TO finnor_app;
    REVOKE DELETE ON finnor_os.authority_decisions FROM finnor_app;
  END IF;
END $rls$;

-- Auth bootstrap now returns employee status and the tenant's current authority
-- revision in the same SECURITY DEFINER lookup as the verified email mapping.
DROP FUNCTION IF EXISTS finnor_os.resolve_authenticated_identity(text);
CREATE FUNCTION finnor_os.resolve_authenticated_identity(p_email text)
RETURNS TABLE (user_id uuid, tenant_id uuid, user_role text, employee_status text, authority_revision integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
  SELECT u.id,u.tenant_id,u.role,u.status,coalesce(s.revision,1)
  FROM finnor_os.users u LEFT JOIN finnor_os.authority_states s ON s.tenant_id=u.tenant_id
  WHERE lower(u.email)=lower(p_email) LIMIT 1
$$;
REVOKE ALL ON FUNCTION finnor_os.resolve_authenticated_identity(text) FROM PUBLIC;
DO $grant$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
  GRANT EXECUTE ON FUNCTION finnor_os.resolve_authenticated_identity(text) TO finnor_app;
END IF; END $grant$;
