# Client release lifecycle

Phase 6 governs the existing Phase 1–5 client factory and certification artifacts. It does not add a workflow engine or a client-specific runtime.

## Governed chain

`active ClientRelease → desired manifest → deterministic diff → impact plan → dry-run → factory convergence → targeted client certification → immutable ClientRelease → guarded promotion → drift verification`

The active release is one mutable pointer. Release/configuration artifacts and promotion history are append-only. Every operator command writes sanitized provenance and evidence to `client_lifecycle_operations`; no resolved credentials, import contents, or customer data are copied into release evidence.

## Operator CLI

```sh
npm run client:lifecycle -- status --client-key=acme-water
npm run client:lifecycle -- diff --manifest=/absolute/path/acme.json
npm run client:lifecycle -- dry-run --manifest=/absolute/path/acme.json
npm run client:lifecycle -- apply --manifest=/absolute/path/acme.json
npm run client:lifecycle -- certify --manifest=/absolute/path/acme.json --factory-run=<uuid> \
  --core-certification=/absolute/path/corecert.json \
  --deployment-evidence=/absolute/path/deployment.json \
  --journey-evidence=/absolute/path/journeys.json
npm run client:lifecycle -- promote --client-key=acme-water --release=clientrelease-...
npm run client:lifecycle -- drift --client-key=acme-water
npm run client:lifecycle -- rollback --client-key=acme-water --to-release=clientrelease-...
```

Drift is never auto-repaired. `apply --reconcile-drift` is the explicit governed override for an already-reviewed drift condition. An unchanged manifest remains a true no-op: no factory run, import replay, policy version bump, provider mutation, release creation, or active-pointer revision.

## Invalidation

| Change | Factory work | Certification work |
|---|---|---|
| Tenant presentation | tenant + health/readiness | identity/completeness/runtime/core guards |
| Workspace wording/settings/location | workspace/policies + health/readiness | workspace/authority + final guards; imports/providers reused |
| Policy | workspace/policies + health/readiness | policy/authority + final guards |
| Credential/integration reference | integrations + health/readiness | credential/provider/capability + final guards |
| Mapping/import definition/source | only changed import keys + health/readiness | changed import replay + downstream journeys/receipts + final guards |
| Canonical core SHA | none when client configuration is unchanged | a new valid core certification and all client gates |

Phase 4 retains per-import input hashes inside its existing import checkpoint. Phase 5 retains prior PASS gate evidence only when the impact plan proves the gate inputs unchanged. Completeness, core-diff, and worker-runtime identity are always checked again.

## Promotion guards

Promotion is refused unless client and core certifications are current PASS artifacts; artifact/configuration/evidence hashes verify; no `BLOCKED_CONFIG` gate remains; the canonical worktree has no unexpected shared-core diff; persisted tenant state matches the candidate release; worker SHA/core certification/deployment identity is present, fresh, and compatible; and no conflicting lifecycle or factory mutation is active.

Promotion inserts an immutable history row and atomically advances the client-scoped active pointer. Post-promotion drift verification runs in the same transaction; failure rolls the pointer change back.

## Drift and rollback

Drift compares the certified manifest/configuration snapshot, sanitized persisted tenant/workspace/policy/integration state, immutable release evidence, active pointer, and current worker core identity. Results are classified as `CLEAN`, `DRIFT`, `BLOCKED_CONFIG`, or `CRITICAL` with exact state paths and hashes. Detection never mutates production.

Rollback is deliberately configuration-only. Tenant presentation, workspace, policy, and reference-only integration changes can converge to a previous PASS release, verify cleanly, and move the active pointer back while keeping every release addressable. Identity, import/mapping, historical fact, or core changes are refused by this rollback path. Sent communications, successful payments, completed actions/workflows, and import runs are counted and reported as retained irreversible effects; the operation is never described as a complete rollback.
