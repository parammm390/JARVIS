-- Phase 1 Universal Business Effect kernel. This extends DomainAction and the
-- existing execution/authority/receipt spine; it does not introduce another action,
-- approval, workflow, or receipt lifecycle.

CREATE TABLE IF NOT EXISTS finnor_os.business_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  domain_action_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version=1),
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  operation_class text NOT NULL CHECK (operation_class IN (
    'internal_draft','internal_write','operational_change','financial_write',
    'external_side_effect','external_spend','batch_external','durable_workflow'
  )),
  effect jsonb NOT NULL CHECK (jsonb_typeof(effect)='object'),
  status text NOT NULL DEFAULT 'compiled' CHECK (status IN (
    'compiled','authorized','executing','executed','verified','partially_verified',
    'unverified','divergent','reconciliation_required','failed','cancelled','compensated'
  )),
  observed_result jsonb,
  verification jsonb,
  replacement_for_effect_id uuid,
  compensation_for_effect_id uuid,
  authorized_at timestamptz,
  execution_started_at timestamptz,
  observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_effects_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT business_effects_action_unique UNIQUE (domain_action_id),
  CONSTRAINT business_effects_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id)
    REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT business_effects_replacement_tenant_fkey FOREIGN KEY (tenant_id,replacement_for_effect_id)
    REFERENCES finnor_os.business_effects(tenant_id,id),
  CONSTRAINT business_effects_compensation_tenant_fkey FOREIGN KEY (tenant_id,compensation_for_effect_id)
    REFERENCES finnor_os.business_effects(tenant_id,id),
  CONSTRAINT business_effects_body_bound_check CHECK (octet_length(effect::text) <= 131072),
  CONSTRAINT business_effects_no_secrets_check CHECK (
    effect::text !~* '"[^"]*(secret|password|token|authorization|bearer|credential|api[_ -]?key|cookie|browser[_ -]?state|session[_ -]?(state|storage)|local[_ -]?storage|private[_ -]?key)[^"]*"[[:space:]]*:'
  )
);
CREATE INDEX IF NOT EXISTS business_effects_tenant_status_idx ON finnor_os.business_effects(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS business_effects_tenant_hash_idx ON finnor_os.business_effects(tenant_id,semantic_hash);

ALTER TABLE finnor_os.domain_actions ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.authority_decisions ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.authority_decisions ADD COLUMN IF NOT EXISTS business_effect_hash text;
ALTER TABLE finnor_os.authority_approval_requests ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.authority_approval_requests ADD COLUMN IF NOT EXISTS business_effect_hash text;
ALTER TABLE finnor_os.business_operations ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.commands ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.workflow_steps ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.external_operations ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.integration_operations ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.reconciliation_cases ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.compensation_cases ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.compensation_cases ADD COLUMN IF NOT EXISTS compensation_effect_id uuid;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS business_effect_id uuid;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS intended_effect_hash text;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS authorized_effect_hash text;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS executed_effect_hash text;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS verification jsonb;
ALTER TABLE finnor_os.decision_receipts ADD COLUMN IF NOT EXISTS recovery_effect_id uuid;
ALTER TABLE finnor_os.computer_runs ADD COLUMN IF NOT EXISTS business_effect_id uuid;

ALTER TABLE finnor_os.authority_decisions DROP CONSTRAINT IF EXISTS authority_decisions_effect_hash_check;
ALTER TABLE finnor_os.authority_decisions ADD CONSTRAINT authority_decisions_effect_hash_check
  CHECK ((business_effect_id IS NULL)=(business_effect_hash IS NULL) AND (business_effect_hash IS NULL OR business_effect_hash ~ '^[0-9a-f]{64}$'));
ALTER TABLE finnor_os.authority_approval_requests DROP CONSTRAINT IF EXISTS authority_approval_requests_effect_hash_check;
ALTER TABLE finnor_os.authority_approval_requests ADD CONSTRAINT authority_approval_requests_effect_hash_check
  CHECK ((business_effect_id IS NULL)=(business_effect_hash IS NULL) AND (business_effect_hash IS NULL OR business_effect_hash ~ '^[0-9a-f]{64}$'));
ALTER TABLE finnor_os.decision_receipts DROP CONSTRAINT IF EXISTS decision_receipts_effect_hashes_check;
ALTER TABLE finnor_os.decision_receipts ADD CONSTRAINT decision_receipts_effect_hashes_check CHECK (
  (intended_effect_hash IS NULL OR intended_effect_hash ~ '^[0-9a-f]{64}$') AND
  (authorized_effect_hash IS NULL OR authorized_effect_hash ~ '^[0-9a-f]{64}$') AND
  (executed_effect_hash IS NULL OR executed_effect_hash ~ '^[0-9a-f]{64}$')
);

DO $constraints$
DECLARE row record;
BEGIN
  FOR row IN SELECT * FROM (VALUES
    ('domain_actions','domain_actions_business_effect_tenant_fkey','business_effect_id'),
    ('authority_decisions','authority_decisions_business_effect_tenant_fkey','business_effect_id'),
    ('authority_approval_requests','authority_approval_requests_business_effect_tenant_fkey','business_effect_id'),
    ('business_operations','business_operations_business_effect_tenant_fkey','business_effect_id'),
    ('commands','commands_business_effect_tenant_fkey','business_effect_id'),
    ('workflow_steps','workflow_steps_business_effect_tenant_fkey','business_effect_id'),
    ('external_operations','external_operations_business_effect_tenant_fkey','business_effect_id'),
    ('integration_operations','integration_operations_business_effect_tenant_fkey','business_effect_id'),
    ('reconciliation_cases','reconciliation_cases_business_effect_tenant_fkey','business_effect_id'),
    ('compensation_cases','compensation_cases_business_effect_tenant_fkey','business_effect_id'),
    ('compensation_cases','compensation_cases_compensation_effect_tenant_fkey','compensation_effect_id'),
    ('decision_receipts','decision_receipts_business_effect_tenant_fkey','business_effect_id'),
    ('decision_receipts','decision_receipts_recovery_effect_tenant_fkey','recovery_effect_id'),
    ('computer_runs','computer_runs_business_effect_tenant_fkey','business_effect_id')
  ) AS refs(table_name,constraint_name,column_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=row.constraint_name AND connamespace='finnor_os'::regnamespace) THEN
      EXECUTE format(
        'ALTER TABLE finnor_os.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id,%I) REFERENCES finnor_os.business_effects(tenant_id,id)',
        row.table_name,row.constraint_name,row.column_name
      );
    END IF;
  END LOOP;
END $constraints$;

-- Defense in depth for the JSON contract itself. Composite FKs protect every stored
-- relational reference; this trigger additionally validates semantic targets/source
-- refs inside the frozen effect so a forged cross-tenant UUID cannot be smuggled into
-- an otherwise tenant-valid Business Effect row.
CREATE OR REPLACE FUNCTION finnor_os.assert_business_effect_scope() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,finnor_os AS $$
DECLARE
  item jsonb;
  binding jsonb;
  kind text;
  target_type text;
  raw_id text;
  target_id uuid;
  resolved uuid;
  source_id uuid;
BEGIN
  IF NEW.domain_action_id IS NOT NULL
    AND NEW.effect#>>'{source,domainActionId}' IS DISTINCT FROM NEW.domain_action_id::text
  THEN RAISE EXCEPTION 'Business Effect source action does not match its canonical action reference';
  END IF;

  BEGIN source_id := nullif(NEW.effect#>>'{source,domainActionId}','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Business Effect source action is invalid'; END;
  IF source_id IS NOT NULL THEN
    SELECT tenant_id INTO resolved FROM finnor_os.domain_actions WHERE id=source_id;
    IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect source action crosses tenant boundary or does not exist'; END IF;
  END IF;

  BEGIN source_id := nullif(NEW.effect#>>'{source,workId}','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Business Effect Work reference is invalid'; END;
  IF source_id IS NOT NULL THEN
    resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.works WHERE id=source_id;
    IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect Work reference crosses tenant boundary or does not exist'; END IF;
  END IF;

  BEGIN source_id := nullif(NEW.effect#>>'{source,objectiveStepId}','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Business Effect objective step reference is invalid'; END;
  IF source_id IS NOT NULL THEN
    resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.work_objective_steps WHERE id=source_id;
    IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect objective step crosses tenant boundary or does not exist'; END IF;
  END IF;

  BEGIN source_id := nullif(NEW.effect#>>'{authority,policyId}','')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'Business Effect policy reference is invalid'; END;
  IF source_id IS NOT NULL THEN
    resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.domain_policies WHERE id=source_id;
    IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect policy crosses tenant boundary or does not exist'; END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(NEW.effect->'targets','[]'::jsonb)) LOOP
    kind := item->>'kind'; target_type := item->>'type'; raw_id := item->>'id'; resolved := NULL; target_id := NULL;
    IF raw_id IS NULL OR target_type IS NULL OR kind IS NULL THEN RAISE EXCEPTION 'Business Effect target is incomplete'; END IF;
    BEGIN target_id := raw_id::uuid; EXCEPTION WHEN invalid_text_representation THEN target_id := NULL; END;
    IF kind='party' THEN
      IF target_id IS NULL THEN RAISE EXCEPTION 'Business Effect PartyRef is invalid'; END IF;
      resolved := finnor_os.party_ref_tenant(target_type,target_id);
    ELSIF kind='entity' THEN
      IF target_type='inventory_item' THEN
        SELECT tenant_id INTO resolved FROM finnor_os.inventory_items WHERE sku=raw_id AND tenant_id=NEW.tenant_id;
      ELSIF target_type='location' THEN
        SELECT tenant_id INTO resolved FROM finnor_os.tenant_locations WHERE id=target_id;
      ELSIF target_type='objective_loop' THEN
        SELECT tenant_id INTO resolved FROM finnor_os.work_objective_loops WHERE id=target_id;
      ELSE
        IF target_id IS NULL THEN RAISE EXCEPTION 'Business Effect canonical entity reference is invalid'; END IF;
        resolved := finnor_os.canonical_entity_tenant(target_type,target_id);
      END IF;
    ELSIF kind='resource' AND target_type='communication_identity' THEN
      SELECT tenant_id INTO resolved FROM finnor_os.communication_identities WHERE id=target_id;
    ELSIF kind='resource' AND target_type='auth_profile' THEN
      SELECT tenant_id INTO resolved FROM finnor_os.auth_profiles WHERE id=target_id;
    ELSIF kind='resource' AND target_type='application_account' THEN
      SELECT tenant_id INTO resolved FROM finnor_os.application_accounts WHERE id=target_id;
    ELSIF kind='resource' AND target_type='business_effect' THEN
      SELECT tenant_id INTO resolved FROM finnor_os.business_effects WHERE id=target_id;
    ELSIF kind='resource' AND target_type IN ('proposed_business_change','phone_endpoint','email_endpoint','recipient_endpoint') THEN
      resolved := NEW.tenant_id;
    ELSE
      RAISE EXCEPTION 'Unsupported Business Effect target kind/type: %/%',kind,target_type;
    END IF;
    IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect target crosses tenant boundary or does not exist'; END IF;
  END LOOP;

  FOR binding IN SELECT value FROM jsonb_array_elements(coalesce(NEW.effect->'bindings','[]'::jsonb)) LOOP
    IF binding->>'communicationIdentityId' IS NOT NULL THEN
      resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.communication_identities WHERE id=(binding->>'communicationIdentityId')::uuid;
      IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect communication identity crosses tenant boundary or does not exist'; END IF;
    END IF;
    IF binding->>'authProfileId' IS NOT NULL THEN
      resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.auth_profiles WHERE id=(binding->>'authProfileId')::uuid;
      IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect auth profile crosses tenant boundary or does not exist'; END IF;
    END IF;
    IF binding->>'applicationAccountId' IS NOT NULL THEN
      resolved := NULL; SELECT tenant_id INTO resolved FROM finnor_os.application_accounts WHERE id=(binding->>'applicationAccountId')::uuid;
      IF resolved IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'Business Effect application account crosses tenant boundary or does not exist'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.assert_business_effect_scope() FROM PUBLIC;
DROP TRIGGER IF EXISTS business_effects_scope_guard ON finnor_os.business_effects;
CREATE TRIGGER business_effects_scope_guard BEFORE INSERT ON finnor_os.business_effects
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_business_effect_scope();

CREATE OR REPLACE FUNCTION finnor_os.guard_business_effect_semantics() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Business Effect evidence is append-only';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.semantic_hash IS DISTINCT FROM OLD.semantic_hash
    OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
    OR NEW.operation_class IS DISTINCT FROM OLD.operation_class
    OR NEW.effect IS DISTINCT FROM OLD.effect
    OR NEW.replacement_for_effect_id IS DISTINCT FROM OLD.replacement_for_effect_id
    OR NEW.compensation_for_effect_id IS DISTINCT FROM OLD.compensation_for_effect_id
  THEN RAISE EXCEPTION 'Business Effect semantic intent is immutable';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_business_effect_semantics() FROM PUBLIC;
DROP TRIGGER IF EXISTS business_effects_semantics_immutable ON finnor_os.business_effects;
CREATE TRIGGER business_effects_semantics_immutable BEFORE UPDATE OR DELETE ON finnor_os.business_effects
  FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_business_effect_semantics();

CREATE OR REPLACE FUNCTION finnor_os.guard_business_effect_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF OLD.business_effect_id IS NOT NULL AND NEW.business_effect_id IS DISTINCT FROM OLD.business_effect_id THEN
    RAISE EXCEPTION 'Business Effect reference is immutable once assigned';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.guard_business_effect_reference() FROM PUBLIC;

DO $triggers$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'domain_actions','business_operations','commands','workflow_steps',
    'external_operations','integration_operations','computer_runs'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finnor_os.%I',table_name||'_effect_ref_immutable',table_name);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF business_effect_id ON finnor_os.%I FOR EACH ROW EXECUTE FUNCTION finnor_os.guard_business_effect_reference()',table_name||'_effect_ref_immutable',table_name);
  END LOOP;
END $triggers$;

ALTER TABLE finnor_os.business_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.business_effects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.business_effects;
CREATE POLICY tenant_isolation ON finnor_os.business_effects
  USING (tenant_id=finnor_os.request_tenant_id())
  WITH CHECK (tenant_id=finnor_os.request_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE ON finnor_os.business_effects TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_business_effect_semantics() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.guard_business_effect_reference() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_business_effect_scope() TO finnor_app;
  END IF;
END $grants$;

DROP TRIGGER IF EXISTS business_effects_operational_delta ON finnor_os.business_effects;
CREATE TRIGGER business_effects_operational_delta AFTER INSERT OR UPDATE OF status ON finnor_os.business_effects
  FOR EACH ROW EXECUTE FUNCTION finnor_os.append_operational_delta('business_effect','work,actions,approvals,receipts,activity','','');

COMMENT ON TABLE finnor_os.business_effects IS
  'Immutable canonical business semantics compiled from a DomainAction before consequential authority/approval/execution. Historical actions are intentionally not fabricated or backfilled.';
