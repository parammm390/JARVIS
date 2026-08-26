-- Phase 1 hardening: generic Party↔Property topology and explicit IR EffectSpec
-- binding. Additive: household/equipment identities and compatibility columns
-- remain readable. Property ownership is no longer structurally dependent on a
-- household compatibility account.

-- Decouple canonical service-location identity from the legacy customer account.
-- All old household values remain; only the NOT NULL ownership topology is removed.
ALTER TABLE finnor_os.equipment DROP CONSTRAINT IF EXISTS equipment_tenant_household_property_fk;
ALTER TABLE finnor_os.service_visits DROP CONSTRAINT IF EXISTS service_visits_tenant_household_property_fk;
ALTER TABLE finnor_os.asset_measurements DROP CONSTRAINT IF EXISTS asset_measurements_tenant_property_fk;
ALTER TABLE finnor_os.asset_measurements DROP CONSTRAINT IF EXISTS asset_measurements_tenant_equipment_fk;
ALTER TABLE finnor_os.properties DROP CONSTRAINT IF EXISTS properties_household_id_fkey;
ALTER TABLE finnor_os.properties DROP CONSTRAINT IF EXISTS properties_tenant_household_fk;
ALTER TABLE finnor_os.properties ALTER COLUMN household_id DROP NOT NULL;
ALTER TABLE finnor_os.properties ADD CONSTRAINT properties_tenant_household_fk
  FOREIGN KEY (tenant_id,household_id) REFERENCES finnor_os.households(tenant_id,id);
ALTER TABLE finnor_os.equipment ADD CONSTRAINT equipment_tenant_property_fk
  FOREIGN KEY (tenant_id,property_id) REFERENCES finnor_os.properties(tenant_id,id);
ALTER TABLE finnor_os.service_visits ADD CONSTRAINT service_visits_tenant_property_fk
  FOREIGN KEY (tenant_id,property_id) REFERENCES finnor_os.properties(tenant_id,id);
ALTER TABLE finnor_os.asset_measurements ADD CONSTRAINT asset_measurements_tenant_property_fk
  FOREIGN KEY (tenant_id,property_id) REFERENCES finnor_os.properties(tenant_id,id);
ALTER TABLE finnor_os.asset_measurements ADD CONSTRAINT asset_measurements_tenant_equipment_fk
  FOREIGN KEY (tenant_id,equipment_id) REFERENCES finnor_os.equipment(tenant_id,id);

CREATE TABLE IF NOT EXISTS finnor_os.property_party_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT finnor_os.request_tenant_id() REFERENCES finnor_os.tenants(id),
  property_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN (
    'employee','team','location','household','contact','external_organization','external_contact'
  )),
  party_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN (
    'customer_account','owner','occupant','property_manager','billing_contact','service_contact','other'
  )),
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provenance)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_party_relationships_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT property_party_relationships_interval_check CHECK (valid_to IS NULL OR valid_to>=valid_from),
  CONSTRAINT property_party_relationships_property_tenant_fk
    FOREIGN KEY (tenant_id,property_id) REFERENCES finnor_os.properties(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS property_party_relationships_active_identity_idx
  ON finnor_os.property_party_relationships(tenant_id,property_id,party_type,party_id,relationship)
  WHERE valid_to IS NULL;
CREATE INDEX IF NOT EXISTS property_party_relationships_property_idx
  ON finnor_os.property_party_relationships(tenant_id,property_id,relationship);
CREATE INDEX IF NOT EXISTS property_party_relationships_party_idx
  ON finnor_os.property_party_relationships(tenant_id,party_type,party_id,relationship);

-- A polymorphic PartyRef cannot use one ordinary FK, so the canonical party
-- resolver enforces existence and tenant ownership at the write boundary.
CREATE OR REPLACE FUNCTION finnor_os.enforce_property_party_relationship_tenant() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved_tenant uuid;
BEGIN
  resolved_tenant := finnor_os.party_ref_tenant(NEW.party_type,NEW.party_id);
  IF resolved_tenant IS NULL OR resolved_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'property party reference is absent or belongs to another tenant';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.enforce_property_party_relationship_tenant() FROM PUBLIC;
DROP TRIGGER IF EXISTS property_party_relationships_tenant_guard ON finnor_os.property_party_relationships;
CREATE TRIGGER property_party_relationships_tenant_guard
BEFORE INSERT OR UPDATE OF tenant_id,party_type,party_id ON finnor_os.property_party_relationships
FOR EACH ROW EXECUTE FUNCTION finnor_os.enforce_property_party_relationship_tenant();

-- Existing household linkage means customer/account compatibility, never an
-- inferred ownership claim. Ownership/occupancy must be written explicitly.
INSERT INTO finnor_os.property_party_relationships(
  tenant_id,property_id,party_type,party_id,relationship,is_primary,valid_from,provenance
)
SELECT p.tenant_id,p.id,'household',p.household_id,'customer_account',true,p.created_at,
       jsonb_build_object('source','migration:0103','compatibilityColumn','properties.household_id')
FROM finnor_os.properties p
WHERE p.household_id IS NOT NULL
ON CONFLICT (tenant_id,property_id,party_type,party_id,relationship) WHERE valid_to IS NULL DO NOTHING;

-- Dual-write the old compatibility column into the canonical relationship model.
-- This never asserts owner/occupant; it only records the explicit customer account.
CREATE OR REPLACE FUNCTION finnor_os.sync_property_household_compatibility() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.household_id IS DISTINCT FROM NEW.household_id AND OLD.household_id IS NOT NULL THEN
    UPDATE finnor_os.property_party_relationships
       SET valid_to=now()
     WHERE tenant_id=OLD.tenant_id AND property_id=OLD.id
       AND party_type='household' AND party_id=OLD.household_id
       AND relationship='customer_account' AND valid_to IS NULL;
  END IF;
  IF NEW.household_id IS NOT NULL THEN
    INSERT INTO finnor_os.property_party_relationships(
      tenant_id,property_id,party_type,party_id,relationship,is_primary,valid_from,provenance
    ) VALUES (
      NEW.tenant_id,NEW.id,'household',NEW.household_id,'customer_account',true,now(),
      jsonb_build_object('source','properties.household_id','compatibility',true)
    ) ON CONFLICT (tenant_id,property_id,party_type,party_id,relationship) WHERE valid_to IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.sync_property_household_compatibility() FROM PUBLIC;
DROP TRIGGER IF EXISTS properties_household_compatibility_sync ON finnor_os.properties;
CREATE TRIGGER properties_household_compatibility_sync
AFTER INSERT OR UPDATE OF household_id ON finnor_os.properties
FOR EACH ROW EXECUTE FUNCTION finnor_os.sync_property_household_compatibility();

-- Assets keep their historical household/account identity. When linked to a
-- property, that account must be an explicit active service/customer relationship;
-- tenant-only matching is never enough.
CREATE OR REPLACE FUNCTION finnor_os.enforce_equipment_property_account() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF NEW.property_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM finnor_os.property_party_relationships r
     WHERE r.tenant_id=NEW.tenant_id AND r.property_id=NEW.property_id
       AND r.party_type='household' AND r.party_id=NEW.household_id
       AND r.relationship='customer_account' AND r.valid_to IS NULL
  ) THEN
    RAISE EXCEPTION 'equipment household is not an active customer account for property';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.enforce_equipment_property_account() FROM PUBLIC;
DROP TRIGGER IF EXISTS equipment_property_account_guard ON finnor_os.equipment;
CREATE TRIGGER equipment_property_account_guard
BEFORE INSERT OR UPDATE OF tenant_id,household_id,property_id ON finnor_os.equipment
FOR EACH ROW EXECUTE FUNCTION finnor_os.enforce_equipment_property_account();

ALTER TABLE finnor_os.planning_ir_artifacts ADD COLUMN IF NOT EXISTS effect_id text;
ALTER TABLE finnor_os.planning_ir_artifacts ADD COLUMN IF NOT EXISTS constraint_evaluations jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE finnor_os.planning_ir_artifacts DROP CONSTRAINT IF EXISTS planning_ir_artifacts_constraint_evaluations_shape;
ALTER TABLE finnor_os.planning_ir_artifacts ADD CONSTRAINT planning_ir_artifacts_constraint_evaluations_shape CHECK (jsonb_typeof(constraint_evaluations)='array');
CREATE INDEX IF NOT EXISTS planning_ir_artifacts_effect_idx
  ON finnor_os.planning_ir_artifacts(tenant_id,effect_id)
  WHERE effect_id IS NOT NULL;

CREATE OR REPLACE FUNCTION finnor_os.freeze_planning_ir_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.domain_action_id IS DISTINCT FROM OLD.domain_action_id
     OR NEW.work_id IS DISTINCT FROM OLD.work_id
     OR NEW.objective_step_id IS DISTINCT FROM OLD.objective_step_id
     OR NEW.effect_id IS DISTINCT FROM OLD.effect_id
     OR NEW.constraint_evaluations IS DISTINCT FROM OLD.constraint_evaluations
     OR NEW.ir_schema_version IS DISTINCT FROM OLD.ir_schema_version
     OR NEW.compiler_version IS DISTINCT FROM OLD.compiler_version
     OR NEW.ir_semantic_hash IS DISTINCT FROM OLD.ir_semantic_hash
     OR NEW.provenance IS DISTINCT FROM OLD.provenance
     OR NEW.artifact IS DISTINCT FROM OLD.artifact
     OR NEW.comparison_classification IS DISTINCT FROM OLD.comparison_classification
     OR NEW.semantic_diff IS DISTINCT FROM OLD.semantic_diff THEN
    RAISE EXCEPTION 'Planning IR semantic identity is immutable';
  END IF;
  RETURN NEW;
END $$;

ALTER TABLE finnor_os.property_party_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE finnor_os.property_party_relationships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON finnor_os.property_party_relationships;
CREATE POLICY tenant_isolation ON finnor_os.property_party_relationships
  USING (tenant_id=finnor_os.request_tenant_id())
  WITH CHECK (tenant_id=finnor_os.request_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON finnor_os.property_party_relationships TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.enforce_property_party_relationship_tenant() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.sync_property_household_compatibility() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.enforce_equipment_property_account() TO finnor_app;
  END IF;
END $grants$;
