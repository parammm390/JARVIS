# Durable client factory

Phase 4 turns the client manifest into one resumable onboarding path:

`validate → tenant → identity → workspace/policies → integrations/credential references → import → tenant health → ready for certification`

The factory uses the existing Phase 1 convergence functions, Phase 2 reference-only
credential bindings, Phase 3 canonical importer, and Postgres `jobs` queue. It does
not resolve or store secrets and is not a second workflow engine.

## Operator commands

```sh
# Persist the run and atomically enqueue it for the existing worker.
npm run factory:client -- --command=start --manifest=/absolute/path/client.json

# Development/operator foreground execution (still uses the durable ledger).
npm run factory:client -- --command=start --manifest=/absolute/path/client.json --inline

npm run factory:client -- --command=status --run=<run-uuid>
npm run factory:client -- --command=status --clientKey=acme-water
npm run factory:client -- --command=resume --run=<run-uuid>
npm run factory:client -- --command=resume --run=<run-uuid> --manifest=/absolute/path/updated-client.json
npm run factory:client -- --command=retry --run=<run-uuid>
npm run factory:client -- --command=cancel --run=<run-uuid>
```

The worker needs the same migration/admin database connection and Supabase service
role variables as existing tenant provisioning. Relative `imports[].sourceRef` paths
are made absolute when the CLI reads the manifest; worker hosts must be able to read
that durable path. Deployments using object storage can inject a source resolver into
the internal `runClientFactory` entrypoint without placing source contents in factory
state.

## State, resume, and invalidation

`client_factory_runs` owns one active mutation path per `client_key`, its current
lease, cancellation request, manifest hash, and reference-only manifest snapshot.
`client_factory_stages` holds the current checkpoint. The append-only
`client_factory_stage_attempts` table preserves prior failures, blocking evidence,
and successful evidence when a stage is retried.

Each stage hashes only its deterministic inputs. A passed stage is reused only when
that hash still matches. A workspace-only manifest change therefore reruns validation,
workspace/policies, health, and readiness; it does not recreate users, rebind unchanged
integrations, or replay unchanged imports. Import hashes include source contents, but
the contents themselves are never copied into factory state.

The job queue and factory lease jointly prevent concurrent mutation. An expired lease
is reclaimable after a worker crash. `blocked_config` is used for actionable missing
references/sources; data quarantine and execution faults remain `failed`. Resume and
retry reuse the same run and its durable evidence. Cancellation takes effect at a
stage boundary so an in-flight convergent transaction is never interrupted halfway.

`ready_for_certification` means structural onboarding is complete. It records which
external provider checks remain for Phase 5; it never fabricates provider success or
creates an immutable release/certification artifact. Continue with the bounded client
command in `docs/release-certification.md`; only that path can create a ClientRelease.
