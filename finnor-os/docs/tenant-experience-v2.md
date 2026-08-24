# Tenant Experience Manifest V2 operations

## Canonical source and precedence

`finnor_os.tenant_settings.workspace_config` remains the sole tenant-wide
presentation aggregate. A manifest-supplied `workspaceConfig` converges that value
through the existing `workspace_policies` factory stage. Omission preserves an
existing value; a new tenant receives `DEFAULT_WORKSPACE_CONFIG`. The API parses
legacy values into V2 on read, and an owner save persists V2. User preferences may
choose a compatible personal landing, but cannot expand tenant/role surface
visibility or backend authority.

The manifest can select only schema-enumerated brand tokens, metrics, quick actions,
projections, extension keys, extension slots, and local logo asset keys. Credentials,
arbitrary URLs, modules, HTML, CSS, queries, and executable behavior are not accepted.

## Rollout

1. Apply migration `0094_phase4_tenant_experience_v2.sql`. It changes the default,
   adds object/secret-key checks, and attaches the existing operational-delta trigger.
   It deliberately does not rewrite existing tenant rows.
2. Deploy the API/factory schema and frontend composition.
3. Validate both synthetic reference manifests through the client factory in the
   target environment. External provider certification remains a separate gate.
4. Apply reviewed customer manifests through the normal resumable factory workflow.

## Rollback

Before rolling application code back to a version that understands only the legacy
workspace shape, export `tenant_id, workspace_config` to protected operational
storage. Then, in a reviewed transaction, project V2 rows to the legacy subset:

```sql
UPDATE finnor_os.tenant_settings
SET workspace_config = jsonb_build_object(
  'enabledSurfaces', workspace_config->'enabledSurfaces',
  'terminology', workspace_config->'terminology',
  'voiceEnabled', workspace_config->'voiceEnabled',
  'navigationPriority', workspace_config->'navigationPriority',
  'brand', jsonb_build_object(
    'accent', workspace_config#>'{brand,accent}',
    'radius', workspace_config#>'{brand,radius}',
    'mark', workspace_config#>'{brand,mark}'
  ),
  'visibility', workspace_config->'visibility'
)
WHERE workspace_config->>'version' = '2';
```

This loses only V2 presentation fields from the active row; the protected export is
the recovery source for a later re-rollout. The migration added no replacement Work,
action, authority, integration, identity, or receipt tables. The preference delta
trigger may remain safely during an application rollback, or be dropped in a later
reviewed schema change after all writers have stopped.

## Failure posture

Malformed or unregistered configuration fails schema validation. The browser keeps
its last valid manifest if a realtime refresh fails, clears tenant state on the
existing auth/session boundary, and never turns unavailable source data into a zero.
Missing production credentials or provider connectivity must be reported as
`BLOCKED_CONFIG`; reference manifests contain no secrets and do not certify live
providers.
