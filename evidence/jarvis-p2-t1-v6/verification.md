# P2.T1 verification

All commands were run from `/Users/paramdave/Desktop/FINNOR/finnor-os` on 2026-08-08.

## Runtime proof

The repository’s documented `npx tsx scripts/dev-db.ts` local Postgres path was started at `postgres://finnor:finnor@localhost:5432/finnor`. The exact tenant/auth integration matrix passed:

```text
npx vitest run tests/unit/work-cases.test.ts tests/integration/work-cases.test.ts --reporter=verbose
Test Files  2 passed (2)
Tests       7 passed (7)
```

The integration suite proves: multiple actions remain under one instruction root; action → workflow → step → receipt survives; same household/invoice across separate instruction roots does not merge; pending approval has no invented run/receipt and links the exact call; terminal failure projects as `Failed`; another tenant is absent; unauthenticated access is `401`; authenticated tenant access is `200`.

## Static proof

```text
npx tsc -p tsconfig.json --noEmit --pretty false
passed

git diff --check
passed
```

The projection is exported from `packages/read-models/src/index.ts` and routed by `apps/api/app/api/read-models/[view]/route.ts` under the existing tenant/auth boundary. No migration or new source-of-truth table was introduced.

The only intentionally unresolved inventory row is `call → agent`: the discovered canonical call/voice schema has no exact agent identifier, so P2 does not invent one. It remains a P3 agent-truth task, not a fabricated P2 join.
