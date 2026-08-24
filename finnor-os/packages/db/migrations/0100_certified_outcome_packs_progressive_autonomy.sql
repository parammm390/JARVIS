-- Phase 5 Certified Outcome Packs + Progressive Autonomy.
--
-- This is a control/evidence layer over Work, Objective loops, Business Effects,
-- authority, policies, durable execution, provider truth, and reconciliation. It
-- deliberately introduces no second executor, queue, approval system, or source of
-- business truth.

CREATE TABLE IF NOT EXISTS finnor_os.outcome_pack_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  work_id uuid NOT NULL REFERENCES finnor_os.works(id),
  objective_loop_id uuid NOT NULL REFERENCES finnor_os.work_objective_loops(id),
  pack_id text NOT NULL,
  pack_version integer NOT NULL,
  mode text NOT NULL CHECK (mode IN ('shadow','approval','autopilot')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','blocked','shadow_recorded','completed','failed','cancelled')),
  certification_fingerprint text NOT NULL,
  objective text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  subject_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_condition jsonb NOT NULL,
  blocked_reason text,
  final_verification jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT outcome_pack_runs_work_idx UNIQUE (work_id),
  CONSTRAINT outcome_pack_runs_objective_idx UNIQUE (objective_loop_id),
  CONSTRAINT outcome_pack_runs_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT outcome_pack_runs_pack_version_check CHECK (pack_version>=1),
  CONSTRAINT outcome_pack_runs_fingerprint_check CHECK (certification_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT outcome_pack_runs_input_check CHECK (jsonb_typeof(input)='object' AND octet_length(input::text)<=131072),
  CONSTRAINT outcome_pack_runs_subject_refs_check CHECK (jsonb_typeof(subject_refs)='array' AND jsonb_array_length(subject_refs)<=50),
  CONSTRAINT outcome_pack_runs_success_check CHECK (jsonb_typeof(success_condition)='object' AND octet_length(success_condition::text)<=131072),
  CONSTRAINT outcome_pack_runs_verification_check CHECK (final_verification IS NULL OR (jsonb_typeof(final_verification)='object' AND octet_length(final_verification::text)<=131072)),
  CONSTRAINT outcome_pack_runs_work_tenant_fkey FOREIGN KEY (tenant_id,work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT outcome_pack_runs_loop_tenant_fkey FOREIGN KEY (tenant_id,objective_loop_id) REFERENCES finnor_os.work_objective_loops(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS outcome_pack_runs_tenant_pack_status_idx ON finnor_os.outcome_pack_runs(tenant_id,pack_id,status,created_at);

CREATE TABLE IF NOT EXISTS finnor_os.tenant_outcome_pack_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  pack_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  default_mode text NOT NULL DEFAULT 'approval' CHECK (default_mode IN ('shadow','approval','autopilot')),
  reason text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  updated_by uuid REFERENCES finnor_os.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_outcome_pack_settings_tenant_pack_idx UNIQUE (tenant_id,pack_id),
  CONSTRAINT tenant_outcome_pack_settings_tenant_id_id_key UNIQUE (tenant_id,id)
);

CREATE TABLE IF NOT EXISTS finnor_os.outcome_pack_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  pack_id text NOT NULL,
  pack_version integer NOT NULL CHECK (pack_version>=1),
  level text NOT NULL CHECK (level IN ('deterministic','chaos','sandbox','live_provider','production')),
  status text NOT NULL CHECK (status IN ('LOCAL_PASS','SANDBOX_PASS','LIVE_TEST_PASS','BLOCKED_CONFIG','NOT_CERTIFIED','SUSPENDED')),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  dependency_versions jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  sample_size integer NOT NULL DEFAULT 0 CHECK (sample_size>=0),
  critical_violations integer NOT NULL DEFAULT 0 CHECK (critical_violations>=0),
  certified_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  suspended_at timestamptz,
  suspension_reason text,
  CONSTRAINT outcome_pack_certification_identity_idx UNIQUE (tenant_id,pack_id,pack_version,level,fingerprint),
  CONSTRAINT outcome_pack_certifications_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT outcome_pack_certifications_dependency_check CHECK (jsonb_typeof(dependency_versions)='object'),
  CONSTRAINT outcome_pack_certifications_evidence_check CHECK (jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=262144),
  CONSTRAINT outcome_pack_certifications_window_check CHECK (valid_until>certified_at)
);
CREATE INDEX IF NOT EXISTS outcome_pack_certification_current_idx ON finnor_os.outcome_pack_certifications(tenant_id,pack_id,status,valid_until);

CREATE TABLE IF NOT EXISTS finnor_os.autonomy_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  pack_id text NOT NULL,
  pack_version integer NOT NULL CHECK (pack_version>=1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked','expired')),
  effect_classes text[] NOT NULL,
  resource_scope jsonb NOT NULL,
  principal text NOT NULL,
  provider_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_amount_usd numeric(14,2),
  max_risk text NOT NULL DEFAULT 'low' CHECK (max_risk IN ('low','medium','high')),
  policy_version integer,
  authority_revision integer NOT NULL CHECK (authority_revision>=1),
  certification_fingerprint text NOT NULL CHECK (certification_fingerprint ~ '^[0-9a-f]{64}$'),
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  review_after timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES finnor_os.users(id),
  revoked_by uuid REFERENCES finnor_os.users(id),
  revoked_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autonomy_grants_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT autonomy_grants_effect_classes_check CHECK (cardinality(effect_classes)>0),
  CONSTRAINT autonomy_grants_resource_scope_check CHECK (jsonb_typeof(resource_scope)='array' AND jsonb_array_length(resource_scope)>0 AND jsonb_array_length(resource_scope)<=100),
  CONSTRAINT autonomy_grants_provider_scope_check CHECK (jsonb_typeof(provider_scope)='array' AND jsonb_array_length(provider_scope)<=50),
  CONSTRAINT autonomy_grants_amount_check CHECK (max_amount_usd IS NULL OR max_amount_usd>=0),
  CONSTRAINT autonomy_grants_window_check CHECK (valid_from<expires_at AND review_after>=valid_from AND review_after<=expires_at),
  CONSTRAINT autonomy_grants_revoke_shape_check CHECK ((status='revoked')=(revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS autonomy_grants_scope_idx ON finnor_os.autonomy_grants(tenant_id,pack_id,status,expires_at);

CREATE TABLE IF NOT EXISTS finnor_os.autonomy_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  outcome_pack_run_id uuid NOT NULL,
  work_id uuid NOT NULL,
  domain_action_id uuid REFERENCES finnor_os.domain_actions(id),
  business_effect_id uuid REFERENCES finnor_os.business_effects(id),
  grant_id uuid REFERENCES finnor_os.autonomy_grants(id),
  mode text NOT NULL CHECK (mode IN ('shadow','approval','autopilot')),
  outcome text NOT NULL CHECK (outcome IN ('shadow_only','approval_required','autopilot_allowed','blocked')),
  eligible boolean NOT NULL,
  reason_codes text[] NOT NULL,
  authority_revision integer,
  policy_version integer,
  certification_fingerprint text NOT NULL CHECK (certification_fingerprint ~ '^[0-9a-f]{64}$'),
  source_health_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autonomy_evaluations_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT autonomy_evaluations_pack_tenant_fkey FOREIGN KEY (tenant_id,outcome_pack_run_id) REFERENCES finnor_os.outcome_pack_runs(tenant_id,id),
  CONSTRAINT autonomy_evaluations_work_tenant_fkey FOREIGN KEY (tenant_id,work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT autonomy_evaluations_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id) REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT autonomy_evaluations_effect_tenant_fkey FOREIGN KEY (tenant_id,business_effect_id) REFERENCES finnor_os.business_effects(tenant_id,id),
  CONSTRAINT autonomy_evaluations_grant_tenant_fkey FOREIGN KEY (tenant_id,grant_id) REFERENCES finnor_os.autonomy_grants(tenant_id,id),
  CONSTRAINT autonomy_evaluations_health_check CHECK (jsonb_typeof(source_health_snapshot)='array' AND jsonb_array_length(source_health_snapshot)<=50),
  CONSTRAINT autonomy_evaluations_scope_check CHECK (jsonb_typeof(scope_snapshot)='object' AND octet_length(scope_snapshot::text)<=131072)
);
CREATE INDEX IF NOT EXISTS autonomy_evaluations_pack_time_idx ON finnor_os.autonomy_evaluations(tenant_id,outcome_pack_run_id,evaluated_at);
CREATE INDEX IF NOT EXISTS autonomy_evaluations_effect_idx ON finnor_os.autonomy_evaluations(business_effect_id);

CREATE TABLE IF NOT EXISTS finnor_os.outcome_shadow_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  outcome_pack_run_id uuid NOT NULL,
  work_id uuid NOT NULL,
  domain_action_id uuid NOT NULL,
  business_effect_id uuid NOT NULL,
  semantic_hash text NOT NULL CHECK (semantic_hash ~ '^[0-9a-f]{64}$'),
  hypothetical_effect jsonb NOT NULL,
  expected_outcome jsonb,
  comparison_status text NOT NULL DEFAULT 'pending' CHECK (comparison_status IN ('pending','matched','modified','divergent','unsafe','inconclusive')),
  observed_outcome jsonb,
  comparison jsonb,
  proposed_at timestamptz NOT NULL DEFAULT now(),
  compared_at timestamptz,
  CONSTRAINT outcome_shadow_proposals_action_idx UNIQUE (domain_action_id),
  CONSTRAINT outcome_shadow_proposals_effect_idx UNIQUE (business_effect_id),
  CONSTRAINT outcome_shadow_proposals_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT outcome_shadow_proposals_pack_tenant_fkey FOREIGN KEY (tenant_id,outcome_pack_run_id) REFERENCES finnor_os.outcome_pack_runs(tenant_id,id),
  CONSTRAINT outcome_shadow_proposals_work_tenant_fkey FOREIGN KEY (tenant_id,work_id) REFERENCES finnor_os.works(tenant_id,id),
  CONSTRAINT outcome_shadow_proposals_action_tenant_fkey FOREIGN KEY (tenant_id,domain_action_id) REFERENCES finnor_os.domain_actions(tenant_id,id),
  CONSTRAINT outcome_shadow_proposals_effect_tenant_fkey FOREIGN KEY (tenant_id,business_effect_id) REFERENCES finnor_os.business_effects(tenant_id,id),
  CONSTRAINT outcome_shadow_proposals_effect_check CHECK (jsonb_typeof(hypothetical_effect)='object' AND octet_length(hypothetical_effect::text)<=262144),
  CONSTRAINT outcome_shadow_proposals_expected_check CHECK (expected_outcome IS NULL OR jsonb_typeof(expected_outcome)='object'),
  CONSTRAINT outcome_shadow_proposals_observed_check CHECK (observed_outcome IS NULL OR jsonb_typeof(observed_outcome)='object'),
  CONSTRAINT outcome_shadow_proposals_comparison_check CHECK (comparison IS NULL OR jsonb_typeof(comparison)='object')
);
CREATE INDEX IF NOT EXISTS outcome_shadow_proposals_pack_status_idx ON finnor_os.outcome_shadow_proposals(tenant_id,outcome_pack_run_id,comparison_status);

-- Pack identity and employee ownership are database boundaries as well as API
-- validation. These additive constraints also make a re-run of this migration
-- harden an already-created Phase 5 schema during release rehearsal.
DO $phase5_constraints$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outcome_pack_runs','tenant_outcome_pack_settings','outcome_pack_certifications','autonomy_grants'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE connamespace='finnor_os'::regnamespace
        AND conname=table_name || '_pack_id_check'
    ) THEN
      EXECUTE format(
        'ALTER TABLE finnor_os.%I ADD CONSTRAINT %I CHECK (pack_id IN (%L,%L,%L,%L,%L))',
        table_name,
        table_name || '_pack_id_check',
        'lead_to_verified_water_test_booking',
        'stuck_installation_service_resolution',
        'overdue_receivable_collection',
        'service_due_lifecycle',
        'general_operator_objective'
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='tenant_outcome_pack_settings_updated_by_tenant_fkey') THEN
    ALTER TABLE finnor_os.tenant_outcome_pack_settings
      ADD CONSTRAINT tenant_outcome_pack_settings_updated_by_tenant_fkey
      FOREIGN KEY (tenant_id,updated_by) REFERENCES finnor_os.users(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='autonomy_grants_created_by_tenant_fkey') THEN
    ALTER TABLE finnor_os.autonomy_grants
      ADD CONSTRAINT autonomy_grants_created_by_tenant_fkey
      FOREIGN KEY (tenant_id,created_by) REFERENCES finnor_os.users(tenant_id,id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE connamespace='finnor_os'::regnamespace AND conname='autonomy_grants_revoked_by_tenant_fkey') THEN
    ALTER TABLE finnor_os.autonomy_grants
      ADD CONSTRAINT autonomy_grants_revoked_by_tenant_fkey
      FOREIGN KEY (tenant_id,revoked_by) REFERENCES finnor_os.users(tenant_id,id);
  END IF;
END $phase5_constraints$;

-- All Phase 5 state is tenant scoped. Workers retain their normal trusted role, but
-- composite tenant FKs make cross-tenant references impossible even on that path.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outcome_pack_runs','tenant_outcome_pack_settings','outcome_pack_certifications',
    'autonomy_grants','autonomy_evaluations','outcome_shadow_proposals'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
END $rls$;

DO $grants$
DECLARE table_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    FOREACH table_name IN ARRAY ARRAY[
      'outcome_pack_runs','tenant_outcome_pack_settings','outcome_pack_certifications',
      'autonomy_grants','autonomy_evaluations','outcome_shadow_proposals'
    ] LOOP
      EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.%I TO finnor_app',table_name);
    END LOOP;
  END IF;
END $grants$;

-- Fail-safe demotion: health/freshness/reconciliation degradation stops grants for
-- packs explicitly bound to that provider integration. Already-committed effects are
-- not rewritten; their observation/reconciliation remains authoritative.
CREATE OR REPLACE FUNCTION finnor_os.suspend_outcome_autonomy_on_source_regression()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.health<>'ok' OR NEW.sync_status<>'synced' OR NEW.freshness_state<>'fresh'
     OR NEW.reconciliation_status<>'healthy' OR NEW.unresolved_conflicts>0 THEN
    UPDATE finnor_os.autonomy_grants
      SET status='suspended', reason='source_or_provider_health_regression', updated_at=now()
      WHERE tenant_id=NEW.tenant_id AND status='active' AND pack_id=ANY(NEW.outcome_packs);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS suspend_outcome_autonomy_on_source_regression ON finnor_os.tenant_integrations;
CREATE TRIGGER suspend_outcome_autonomy_on_source_regression
  AFTER UPDATE OF health,sync_status,freshness_state,reconciliation_status,unresolved_conflicts
  ON finnor_os.tenant_integrations FOR EACH ROW
  EXECUTE FUNCTION finnor_os.suspend_outcome_autonomy_on_source_regression();

CREATE OR REPLACE FUNCTION finnor_os.suspend_outcome_autonomy_on_authority_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE finnor_os.autonomy_grants
    SET status='suspended', reason='authority_revision_changed', updated_at=now()
    WHERE tenant_id=NEW.tenant_id AND status='active' AND authority_revision<>NEW.revision;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS suspend_outcome_autonomy_on_authority_revision ON finnor_os.authority_states;
CREATE TRIGGER suspend_outcome_autonomy_on_authority_revision
  AFTER UPDATE OF revision ON finnor_os.authority_states FOR EACH ROW
  EXECUTE FUNCTION finnor_os.suspend_outcome_autonomy_on_authority_revision();

CREATE OR REPLACE FUNCTION finnor_os.suspend_outcome_autonomy_on_policy_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE finnor_os.autonomy_grants
    SET status='suspended', reason='policy_revision_changed', updated_at=now()
    WHERE tenant_id=NEW.tenant_id AND status='active'
      AND policy_version IS NOT NULL AND policy_version<>NEW.version;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS suspend_outcome_autonomy_on_policy_revision ON finnor_os.domain_policies;
CREATE TRIGGER suspend_outcome_autonomy_on_policy_revision
  AFTER INSERT OR UPDATE OF version ON finnor_os.domain_policies FOR EACH ROW
  EXECUTE FUNCTION finnor_os.suspend_outcome_autonomy_on_policy_revision();

COMMENT ON TABLE finnor_os.outcome_pack_runs IS 'Canonical binding of one certified outcome contract to the existing Work and Objective controller.';
COMMENT ON TABLE finnor_os.autonomy_grants IS 'Narrow, expiring tenant+pack+effect+resource+principal+provider scope; authority and policy remain final.';
COMMENT ON TABLE finnor_os.autonomy_evaluations IS 'Deterministic explanation of why one exact EffectSet was shadowed, gated, allowed, or blocked.';
COMMENT ON TABLE finnor_os.outcome_shadow_proposals IS 'Hypothetical EffectSet evidence only; no row in this table authorizes or executes a consequential effect.';
