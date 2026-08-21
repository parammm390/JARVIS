-- Phase 1: governed Identity + Access Binding Fabric.
--
-- These tables contain stable business handles, non-secret routing metadata, and
-- opaque references into the existing credential architecture. They never contain
-- passwords, tokens, API keys, cookies, or saved browser state. Employee Authority
-- remains the permission boundary; a binding only says which principal owns an
-- identity/account, never that every employee may use it.

ALTER TABLE finnor_os.tenant_integrations
  DROP CONSTRAINT IF EXISTS tenant_integrations_credential_contract_check;
ALTER TABLE finnor_os.tenant_integrations
  ADD CONSTRAINT tenant_integrations_credential_contract_check CHECK (
    (credential_provider IS NULL AND credential_ref IS NULL
      AND credential_version IS NULL AND credential_metadata='{}'::jsonb)
    OR (credential_provider='aws-secrets-manager' AND credential_ref IS NOT NULL
      AND btrim(credential_ref)<>'' AND (credential_version IS NULL OR btrim(credential_version)<>''))
    OR (credential_provider='legacy-env'
      AND credential_ref ~ '^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|gmail|resend|meta_ads|google_ads)$'
      AND credential_version IS NULL)
  );

CREATE TABLE IF NOT EXISTS finnor_os.communication_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  identity_key text NOT NULL,
  provider text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','sms','voice','chat','calendar')),
  address text,
  provider_identity_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','suspended')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities)='array'),
  credential_provider text,
  credential_ref text,
  credential_version text,
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_identities_key_format_check
    CHECK (identity_key=lower(identity_key) AND identity_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT communication_identities_provider_format_check
    CHECK (provider=lower(provider) AND provider ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  CONSTRAINT communication_identities_endpoint_check
    CHECK (coalesce(btrim(address),'')<>'' OR coalesce(btrim(provider_identity_ref),'')<>''),
  CONSTRAINT communication_identities_tenant_key_unique UNIQUE (tenant_id,identity_key),
  CONSTRAINT communication_identities_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT communication_identities_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.communication_identity_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  communication_identity_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('employee','team','location','tenant')),
  principal_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'default' CHECK (btrim(purpose)<>'' AND length(purpose)<=120),
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_identity_bindings_identity_unique
    UNIQUE (tenant_id,communication_identity_id,principal_type,principal_id,purpose),
  CONSTRAINT communication_identity_bindings_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT communication_identity_bindings_identity_tenant_fkey
    FOREIGN KEY (tenant_id,communication_identity_id)
    REFERENCES finnor_os.communication_identities(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT communication_identity_bindings_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.application_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  account_key text NOT NULL,
  application text NOT NULL,
  provider text NOT NULL,
  display_name text NOT NULL,
  provider_account_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','suspended')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities)='array'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_accounts_key_format_check
    CHECK (account_key=lower(account_key) AND account_key ~ '^[a-z0-9][a-z0-9_-]{1,62}[a-z0-9]$'),
  CONSTRAINT application_accounts_application_format_check
    CHECK (application=lower(application) AND application ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  CONSTRAINT application_accounts_provider_format_check
    CHECK (provider=lower(provider) AND provider ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  CONSTRAINT application_accounts_tenant_key_unique UNIQUE (tenant_id,account_key),
  CONSTRAINT application_accounts_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT application_accounts_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

CREATE TABLE IF NOT EXISTS finnor_os.auth_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES finnor_os.tenants(id),
  auth_profile_ref text NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('employee','team','location','tenant')),
  principal_id uuid NOT NULL,
  application_account_id uuid NOT NULL,
  purpose text NOT NULL DEFAULT 'default' CHECK (btrim(purpose)<>'' AND length(purpose)<=120),
  priority integer NOT NULL DEFAULT 0,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(scope)='object'),
  credential_provider text,
  credential_ref text,
  credential_version text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','suspended')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(capabilities)='array'),
  restrictions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(restrictions)='object'),
  managed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_profiles_ref_format_check
    CHECK (auth_profile_ref=lower(auth_profile_ref) AND auth_profile_ref ~ '^[a-z0-9][a-z0-9_-]{1,126}[a-z0-9]$'),
  CONSTRAINT auth_profiles_tenant_ref_unique UNIQUE (tenant_id,auth_profile_ref),
  CONSTRAINT auth_profiles_tenant_id_id_key UNIQUE (tenant_id,id),
  CONSTRAINT auth_profiles_binding_unique
    UNIQUE (tenant_id,application_account_id,principal_type,principal_id,purpose),
  CONSTRAINT auth_profiles_account_tenant_fkey
    FOREIGN KEY (tenant_id,application_account_id)
    REFERENCES finnor_os.application_accounts(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT auth_profiles_managed_by_tenant_fkey
    FOREIGN KEY (tenant_id,managed_by) REFERENCES finnor_os.tenants(id,client_key)
);

-- References use the existing AWS/legacy mechanisms. AWS references must carry the
-- row tenant UUID, so an owner/migration connection cannot attach Tenant B's secret
-- path to Tenant A. Legacy env references remain explicit and provider-matched.
ALTER TABLE finnor_os.communication_identities
  ADD CONSTRAINT communication_identities_credential_contract_check CHECK (
    (credential_provider IS NULL AND credential_ref IS NULL AND credential_version IS NULL)
    OR (credential_provider='aws-secrets-manager' AND credential_ref IS NOT NULL
        AND btrim(credential_ref)<>'' AND position(tenant_id::text IN credential_ref)>0
        AND (credential_version IS NULL OR btrim(credential_version)<>''))
    OR (credential_provider='legacy-env' AND credential_ref='legacy-env:'||provider
        AND credential_version IS NULL)
  );
ALTER TABLE finnor_os.auth_profiles
  ADD CONSTRAINT auth_profiles_credential_contract_check CHECK (
    (credential_provider IS NULL AND credential_ref IS NULL AND credential_version IS NULL)
    OR (credential_provider='aws-secrets-manager' AND credential_ref IS NOT NULL
        AND btrim(credential_ref)<>'' AND position(tenant_id::text IN credential_ref)>0
        AND (credential_version IS NULL OR btrim(credential_version)<>''))
    OR (credential_provider='legacy-env' AND credential_ref ~ '^legacy-env:(quickbooks|vapi|stripe|docusign|ghl|gmail|resend|meta_ads|google_ads)$'
        AND credential_version IS NULL)
  );

-- JSON exposed to normal application reads may contain routing/account metadata but
-- never secret-shaped keys. Values are never logged by the resolver either.
ALTER TABLE finnor_os.application_accounts
  ADD CONSTRAINT application_accounts_metadata_contains_no_secrets CHECK (
    metadata::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
  );
ALTER TABLE finnor_os.auth_profiles
  ADD CONSTRAINT auth_profiles_scope_contains_no_secrets CHECK (
    scope::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
  );
ALTER TABLE finnor_os.auth_profiles
  ADD CONSTRAINT auth_profiles_restrictions_contains_no_secrets CHECK (
    restrictions::text !~* '"[^"]*(secret|password|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|api[ _-]?key|credential|cookie|session[ _-]?storage|local[ _-]?storage)[^"]*"[[:space:]]*:'
  );

CREATE INDEX IF NOT EXISTS communication_identities_tenant_channel_status_idx
  ON finnor_os.communication_identities(tenant_id,channel,status,provider);
CREATE INDEX IF NOT EXISTS communication_identities_tenant_managed_by_idx
  ON finnor_os.communication_identities(tenant_id,managed_by) WHERE managed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS communication_identity_bindings_principal_lookup_idx
  ON finnor_os.communication_identity_bindings(tenant_id,principal_type,principal_id,status,purpose,priority DESC);
CREATE INDEX IF NOT EXISTS communication_identity_bindings_identity_idx
  ON finnor_os.communication_identity_bindings(tenant_id,communication_identity_id,status);
CREATE INDEX IF NOT EXISTS communication_identity_bindings_managed_by_idx
  ON finnor_os.communication_identity_bindings(tenant_id,managed_by) WHERE managed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_accounts_tenant_application_status_idx
  ON finnor_os.application_accounts(tenant_id,application,status,provider);
CREATE INDEX IF NOT EXISTS application_accounts_tenant_managed_by_idx
  ON finnor_os.application_accounts(tenant_id,managed_by) WHERE managed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS auth_profiles_principal_lookup_idx
  ON finnor_os.auth_profiles(tenant_id,principal_type,principal_id,status,purpose,priority DESC);
CREATE INDEX IF NOT EXISTS auth_profiles_account_status_idx
  ON finnor_os.auth_profiles(tenant_id,application_account_id,status);
CREATE INDEX IF NOT EXISTS auth_profiles_managed_by_idx
  ON finnor_os.auth_profiles(tenant_id,managed_by) WHERE managed_by IS NOT NULL;

-- Polymorphic principal references cannot use one ordinary FK. Validate them at the
-- database boundary so even a table-owner provisioning connection fails closed.
CREATE OR REPLACE FUNCTION finnor_os.assert_identity_access_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,finnor_os AS $$
DECLARE resolved_tenant uuid;
BEGIN
  IF NEW.principal_type='employee' THEN
    SELECT tenant_id INTO resolved_tenant FROM finnor_os.users WHERE id=NEW.principal_id;
  ELSIF NEW.principal_type='team' THEN
    SELECT tenant_id INTO resolved_tenant FROM finnor_os.org_units WHERE id=NEW.principal_id;
  ELSIF NEW.principal_type='location' THEN
    SELECT tenant_id INTO resolved_tenant FROM finnor_os.tenant_locations WHERE id=NEW.principal_id;
  ELSIF NEW.principal_type='tenant' THEN
    resolved_tenant := NEW.principal_id;
  ELSE
    RAISE EXCEPTION 'unsupported identity principal type: %', NEW.principal_type;
  END IF;
  IF resolved_tenant IS NULL OR resolved_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'identity principal crosses tenant boundary';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION finnor_os.assert_identity_access_scope() FROM PUBLIC;

DROP TRIGGER IF EXISTS communication_identity_binding_scope ON finnor_os.communication_identity_bindings;
CREATE TRIGGER communication_identity_binding_scope
  BEFORE INSERT OR UPDATE ON finnor_os.communication_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_identity_access_scope();
DROP TRIGGER IF EXISTS auth_profile_principal_scope ON finnor_os.auth_profiles;
CREATE TRIGGER auth_profile_principal_scope
  BEFORE INSERT OR UPDATE ON finnor_os.auth_profiles
  FOR EACH ROW EXECUTE FUNCTION finnor_os.assert_identity_access_scope();

-- Existing explicit tenant integrations become canonical tenant/shared access rows.
-- Emulator/native rows are deliberately excluded: they need no real credential.
WITH source AS (
  SELECT i.*,
         left('legacy-'||regexp_replace(lower(i.capability||'-'||i.binding),'[^a-z0-9_-]+','-','g'),64) AS access_key,
         CASE WHEN i.binding='vapi' THEN 'voice'
              WHEN i.binding='ghl' AND i.capability='scheduling' THEN 'calendar'
              WHEN i.binding='ghl' THEN 'sms'
              ELSE 'email' END AS resolved_channel
  FROM finnor_os.tenant_integrations i
  WHERE i.mode<>'emulator' AND i.binding IN ('vapi','ghl','gmail','resend')
)
INSERT INTO finnor_os.communication_identities
  (tenant_id,identity_key,provider,channel,address,provider_identity_ref,status,capabilities,
   credential_provider,credential_ref,credential_version,managed_by)
SELECT s.tenant_id,access_key,binding,resolved_channel,
       coalesce(nullif(credential_metadata->>'fromAddress',''),nullif(credential_metadata->>'address',''),
                nullif(credential_metadata->>'user',''),nullif(config->>'fromAddress',''),
                nullif(config->>'address',''),nullif(config->>'user','')),
       coalesce(nullif(credential_metadata->>'phoneNumberId',''),nullif(credential_metadata->>'locationId',''),
                nullif(config->>'phoneNumberId',''),nullif(config->>'locationId',''),'integration:'||s.id::text),
       'active',jsonb_build_array(capability),credential_provider,credential_ref,credential_version,t.client_key
FROM source s JOIN finnor_os.tenants t ON t.id=s.tenant_id
ON CONFLICT (tenant_id,identity_key) DO NOTHING;

WITH source AS (
  SELECT i.tenant_id,
         left('legacy-'||regexp_replace(lower(i.capability||'-'||i.binding),'[^a-z0-9_-]+','-','g'),64) AS access_key
  FROM finnor_os.tenant_integrations i
  WHERE i.mode<>'emulator' AND i.binding IN ('vapi','ghl','gmail','resend')
)
INSERT INTO finnor_os.communication_identity_bindings
  (tenant_id,communication_identity_id,principal_type,principal_id,purpose,priority,status,managed_by)
SELECT s.tenant_id,c.id,'tenant',s.tenant_id,'default',0,'active',t.client_key
FROM source s JOIN finnor_os.communication_identities c
  ON c.tenant_id=s.tenant_id AND c.identity_key=s.access_key
JOIN finnor_os.tenants t ON t.id=s.tenant_id
ON CONFLICT (tenant_id,communication_identity_id,principal_type,principal_id,purpose) DO NOTHING;

WITH source AS (
  SELECT i.*,
         left('legacy-'||regexp_replace(lower(i.capability||'-'||i.binding),'[^a-z0-9_-]+','-','g'),64) AS access_key
  FROM finnor_os.tenant_integrations i
  WHERE i.mode<>'emulator' AND i.binding NOT IN ('native','emulator','dry_run')
)
INSERT INTO finnor_os.application_accounts
  (tenant_id,account_key,application,provider,display_name,provider_account_ref,status,capabilities,metadata,managed_by)
SELECT s.tenant_id,access_key,
       CASE WHEN binding='ads' THEN coalesce(nullif(credential_metadata->>'adapter',''),nullif(config->>'adapter',''),'ads') ELSE binding END,
       CASE WHEN binding='ads' THEN coalesce(nullif(credential_metadata->>'adapter',''),nullif(config->>'adapter',''),'ads') ELSE binding END,
       initcap(replace(binding,'_',' '))||' shared account',
       coalesce(nullif(credential_metadata->>'accountId',''),nullif(credential_metadata->>'realmId',''),
                nullif(credential_metadata->>'customerId',''),nullif(config->>'accountId',''),
                nullif(config->>'realmId',''),nullif(config->>'customerId','')),
       'active',jsonb_build_array(capability),'{}'::jsonb,t.client_key
FROM source s JOIN finnor_os.tenants t ON t.id=s.tenant_id
ON CONFLICT (tenant_id,account_key) DO NOTHING;

WITH source AS (
  SELECT i.*,
         left('legacy-'||regexp_replace(lower(i.capability||'-'||i.binding),'[^a-z0-9_-]+','-','g'),64) AS access_key
  FROM finnor_os.tenant_integrations i
  WHERE i.mode<>'emulator' AND i.binding NOT IN ('native','emulator','dry_run')
)
INSERT INTO finnor_os.auth_profiles
  (tenant_id,auth_profile_ref,principal_type,principal_id,application_account_id,purpose,priority,scope,
   credential_provider,credential_ref,credential_version,status,capabilities,restrictions,managed_by)
SELECT s.tenant_id,s.access_key,'tenant',s.tenant_id,a.id,'default',0,'{}'::jsonb,
       s.credential_provider,s.credential_ref,s.credential_version,'active',jsonb_build_array(s.capability),'{}'::jsonb,t.client_key
FROM source s JOIN finnor_os.application_accounts a
  ON a.tenant_id=s.tenant_id AND a.account_key=s.access_key
JOIN finnor_os.tenants t ON t.id=s.tenant_id
ON CONFLICT (tenant_id,auth_profile_ref) DO NOTHING;

-- Extend, rather than replace, the existing Employee Authority bootstrap. Relevant
-- self/team/location/tenant bindings still require these grants. Cross-principal
-- impersonation uses identity:act_as/account:act_as, which are never granted here.
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
    INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
      VALUES (p_tenant,selected_role_id,'identity:use','communication_identity','allow','high')
      ON CONFLICT (role_id,capability,resource_type) DO NOTHING;
    INSERT INTO finnor_os.role_authority_grants(tenant_id,role_id,capability,resource_type,effect,max_risk)
      VALUES (p_tenant,selected_role_id,'account:use','application_account','allow','high')
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

-- Every Phase 1 row has the same enforced tenant boundary as Phase 0 and the Work
-- Kernel. The schema is private/non-Data-API; finnor_app receives only direct runtime
-- privileges and RLS still applies to every read and write.
DO $rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'communication_identities','communication_identity_bindings','application_accounts','auth_profiles'
  ] LOOP
    EXECUTE format('ALTER TABLE finnor_os.%I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE finnor_os.%I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON finnor_os.%I',table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON finnor_os.%I USING (tenant_id=finnor_os.request_tenant_id()) WITH CHECK (tenant_id=finnor_os.request_tenant_id())',table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='finnor_app') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON
      finnor_os.communication_identities,
      finnor_os.communication_identity_bindings,
      finnor_os.application_accounts,
      finnor_os.auth_profiles TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.assert_identity_access_scope() TO finnor_app;
    GRANT EXECUTE ON FUNCTION finnor_os.ensure_legacy_authority(uuid) TO finnor_app;
  END IF;
END $rls$;
