# FINNOR core and client certification

Phase 5 repairs the existing `release:certify` entry point and makes it the single
governance layer over the Phase 1–4 client factory and the canonical production
deployment scripts. It does not deploy services or replace the factory/runtime.

Phase 6 promotion, update, drift, and configuration-only rollback are documented in
`docs/client-release-lifecycle.md`. That layer consumes these artifacts without
weakening or duplicating this certification boundary.

## Status contract

Every terminal core/client certification and every ClientRelease records exactly one
of `PASS`, `FAIL`, or `BLOCKED_CONFIG`.

- `PASS`: every required gate produced positive evidence.
- `FAIL`: a gate ran and contradicted the release invariant. FAIL wins if a run also
  contains configuration blockers.
- `BLOCKED_CONFIG`: evidence could not be obtained because required tenant/deployment/
  provider configuration is absent or stale. It is never promoted to PASS.

## Core certification (once per canonical SHA)

```sh
npm run release:certify -- core --core-sha=<40-character-sha>
```

The orchestrator runs the existing typecheck/build, test, migration, RLS/security,
action-contract, policy/approval, workflow recovery, queue/idempotency, load/latency,
and canonical release-provenance commands. Evidence contains deterministic command
identity and exit states, not volatile logs or credentials. A PASS artifact is reusable only when the core
SHA, protected source-tree hash, suite version, and suite hash all match. The artifact
is stored content-addressed under `.certifications/core/`; when `DATABASE_URL` is
available it is also inserted into the append-only certification ledger and can be
reused from that durable ledger by later runs.

The production workflow runs this expensive matrix once, transfers the immutable
artifact to the repaired deploy job, and makes `deploy-production.mjs` reject a
missing, non-PASS, wrong-SHA, incomplete, or hash-tampered core certification. The
certification id is embedded in deployment metadata and `/api/release` and is verified
after deployment. Failed/blocked artifacts are retained for diagnosis but are never
accepted by the deploy job.

## Client certification (bounded per client deployment)

```sh
npm run release:certify -- client \
  --manifest=/absolute/path/client.json \
  --factory-run=<passed-factory-run-uuid> \
  --core-certification=/absolute/path/corecert-....json \
  --deployment-evidence=/absolute/path/verified-live-release.json \
  --journey-evidence=/absolute/path/client-journeys.json \
  [--predecessor-release=clientrelease-...] \
  [--rollback-target=clientrelease-...]
```

The client matrix is deliberately bounded. It verifies the exact factory manifest and
tenant identity, users/cross-tenant isolation, deployed workspace/policies, reference-
only credentials, tenant integration bindings and recent real provider health,
canonical import replay (`created=0`, `updated=0`, `quarantined=0`), required capabilities,
approval/authority state, worker heartbeat/backlogs, representative water-treatment
journeys, finalized policy/evidence/outcome receipts, deployment provenance, schema
compatibility, and the core-diff boundary.

Provider health is read from the tenant-specific health rows written by the real
provider probes. An unprobed/stale provider is `BLOCKED_CONFIG`; unhealthy is `FAIL`.
A capability declared required but bound to an emulator is also `BLOCKED_CONFIG`—an
emulator can exercise wiring but cannot certify a production client provider.
Journey evidence must bind its receipt ids to the same core SHA and deployment evidence
hash and cover `schedule_water_test`, `size_equipment_for_household`, and
`generate_quote`. The tool never fabricates a live provider or journey result.

## Immutable ClientRelease

The content-addressed release records client/tenant identity; canonical core SHA and
core certification; manifest, mapping, import-definition, policy, workspace, aggregate
configuration, schema, and deployment hashes; migration version; credential-reference
status/hash (never values); provider health; client certification evidence/result;
release id/version; timestamps; factory provenance; and predecessor/rollback target.

Files are created exclusively and made read-only. Database rows are insert-only and
protected by triggers that reject UPDATE/DELETE; database checks bind every indexed
identity/status/hash back to its JSON artifact. Rollback references must resolve to an
immutable release for the same client and tenant. An identical rerun resolves to the
same certification/release identity and existing immutable timestamped artifact.

## Invalidation and core-diff rules

- Changed canonical core SHA or protected core tree: no core reuse; new core
  certification required.
- Changed manifest/mapping/import definition/policy/workspace/integration reference or
  deployment evidence: new client certification and ClientRelease identities.
- Changed schema/migration version or gate evidence: new identities.
- Client-generated files are allowed only in explicit client/evidence directories.
  Changes under shared apps, packages, scripts, tests, infrastructure, workflows, or
  product source make `core_diff_guard=FAIL` against the referenced core SHA.
- A FAIL/BLOCKED client certification can be retained as immutable audit evidence but
  can never carry a PASS ClientRelease status or be represented as safe to operate.
