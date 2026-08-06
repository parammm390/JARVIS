# Jarvis realtime release preparation

The instruction trace contract is now present in source, the migration bundle,
the backend OpenAPI document, the tenant-scoped proxy routes, and the frontend
transport. Run the read-only preflight before preparing a release:

```sh
npm run jarvis:realtime:verify
npm --prefix finnor-os run typecheck
npm --prefix finnor-os test -- --run tests/integration/instructions-routes.test.ts
npm run test:unit -- --run src/components/jarvis/kernel
```

Migration `0062_instruction_lifecycle.sql` must be applied through the normal
staging/production migration job before enabling the realtime path. This task
does not apply it, inspect production state, or deploy. The migration is safe to
re-run (`IF NOT EXISTS`/`IF EXISTS` guards), but the release operator should still
verify the migration ledger and staging route checks using the repository's normal
deployment credentials and change window.

Recommended release order:

1. Run the read-only preflight and generated OpenAPI/type checks.
2. Apply migration 0062 to staging using the existing database migration job.
3. Verify authenticated `GET /api/instructions/{id}/events` and `GET /api/stream`
   for a staging instruction, including a 404 for an unknown/foreign id.
4. Deploy the API/worker and web relay together, then run the focused browser
   smoke for SSE, poll fallback, visible transport health, and event-to-pixel
   telemetry.
5. Promote only after the staging trace contains real `received`, `planning`,
   `plan_ready`, and terminal/gated events.

If the migration or stream route is absent in an environment, the frontend keeps
the POST result as a bounded fallback and labels trace transport as unavailable;
it does not claim that lifecycle events were streamed.
