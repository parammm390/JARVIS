# FINNOR Operational Effect System P2

P2 is based on certified P1 SHA `18d35eb27320a8b89377208d652e2230ce2b5deb`. It answers whether an Operational Program is structurally legal to propose; it never answers whether the current actor is authorized now.

The pure `@finnor/operational-ir` package now infers typed resource/information effects, composes them across the complete program, evaluates information flow, resolves explicit tenant-scoped entity/capability facts through an injected read-only boundary, emits an authorized-requirement manifest, and returns `ADMISSIBLE`, `REJECTED`, or `UNRESOLVED`. The P2 lowerer only invokes the existing lowerer after `ADMISSIBLE`; existing BusinessEffect compilation, Authority, approvals, precondition revalidation, provider/computer governance, reconciliation, and verification remain mandatory.

Production uses additive P2 shadowing for the same deterministic Operational Query candidate. Representative internal-write, communication, financial/spend, computer-write, and read-only classes are locked in the pure shadow/enforcement corpus. Broad planner action cutover is not fabricated because certified P1 action candidates do not yet carry complete same-candidate desired-state Operational Programs; that seam is explicit in `effect-system-contract.json`.

Run `npm run test:p2:unit`, `npm run test:p2:locked`, `npm run test:p2:contract`, `npm run test:p2:replay`, and `npm run p2:certify` for deterministic local evidence.

## Closure lineage and release gate

The final closure branch is anchored to the exact remote-main tree recorded in
`lineageReconciliation`; the earlier certified P1 ref was local-only and is retained as
historical provenance. Closure certification runs the unchanged P0/P1/P2 proofs in an
explicit closure mode, while the normal phase certifiers keep their dedicated-branch
guards.

`release:chaos` creates a disposable local database per integration group. The runner
provisions the existing restricted `finnor_app` role only inside that disposable
database, runs the normal migrations, invokes the canonical LangGraph checkpointer
setup, and applies grants only to the disposable schemas. This fixes the historical
`0001_local_app_role`/temporary-database setup gap without changing production
migrations, RLS policies, tenant isolation, auth, or security assertions. All four
groups and all fourteen fault scenarios remain required to pass; credentials are still
removed from child processes and every temporary database is dropped after its group.
