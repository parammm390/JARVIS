# FINNOR existing-substrate P0 freeze

This directory freezes the execution substrate at baseline `8fcd8a1cebcf92791047777c0d9c70e95fc7aad2` on branch `codex/p0-existing-substrate-freeze`. P0 adds no migration and defines no new route, authority system, BusinessEffect identity, Work lifecycle, context architecture, provider operation domain, or product intelligence. Four narrowly scoped invariant-conformance corrections under `apps/` and `packages/` are recorded exhaustively in `runtime-corrections.json`; the ledger proves that they preserve the existing execution models and identity domains.

`substrate-contract.json.authoritativeExecutionMap` is the one authoritative execution map. The other files prove or inventory that map; they do not define alternate architecture.

## Locked artifacts

- `substrate-contract.json` records the actual five execution models, semantic ownership matrix, governed effect boundary, exact schema-backed lifecycles and transition policies, truth precedence, canonical business-truth registry, compatibility seams, and deferred work.
- `capability-inventory.json` is generated from the current plugin registry, fixed action hardening specification, typed query registry, CapabilityContract exports/bindings, and default tool registry. Its deterministic hash detects drift.
- `invariants.json` binds every P0 invariant to current enforcement code and executable tests and carries the 17 zero-tolerance hard gates.
- `replay-corpus.json` locks 24 required semantic cases to deterministic existing tests. Its corpus hash excludes no case data and uses no live model/provider/network dependency.
- `reference-inventory.json` records exact pre/post reference counts by file for 24 architecture-critical concepts. Production scope is `apps/` plus `packages/`; P0 requires zero movement there. Assurance-only movement in `scripts/` and `tests/` is enumerated.
- `runtime-corrections.json` is the closed allowlist for four current-semantics corrections and nine stale-fixture alignments discovered by the clean-database audit.
- `certification-result.json` records the exact deterministic test, build, migration, release-contract, chaos, and P0 gate outcomes, plus the staging/live gates that were deliberately not promoted into local evidence.

## Executable freeze

Run:

```text
npm run p0:inventory
npm run p0:certify
npm run test:p0:contract
npm run test:p0:replay
```

The certifier compares every lifecycle list against the Drizzle schema/runtime constants, regenerates the capability and reference inventories, validates every enforcement/test anchor, verifies the replay hash/selectors, rejects runtime changes outside the P0 allowlist, and compares the current internal package dependency graph to the baseline.

The locked replay runner boots a disposable local Postgres cluster, removes live-provider credentials from the child test environment, runs the unique deterministic files selected by the corpus, rejects skipped tests, then stops and removes only the temporary cluster it created.

## Certified result

The local deterministic certification is `PASS`: the FINNOR OS suite passed 1,479 tests in 294 files (five tests in three files remain explicitly skipped), the frontend suite passed 574 tests in 66 files, all three production builds completed, the 24-case locked replay passed without a skipped selector, the 59-action contract and 14-fault chaos matrix passed, all 104 migrations bundled and the current database was at migration 0103, and the P0 certifier found zero production reference movement and zero internal package cycles.

The staging load runner was also exercised and returned its designed `BLOCKED_CONFIG` result before egress because no staging targets, credentials, or reconciliation evidence were supplied. Live-provider/model gates and the production provenance command are not local P0 evidence: the former require external credentials and the latter must reject this required non-`main` PR branch. Those exclusions are explicit in `certification-result.json` rather than being reported as passes.

## Reality retained, not migrated

P0 records compatibility rather than hiding it: `instruction_sessions`; null `works.execution_model` for conversation; the legacy fast-read adapter; LangGraph/legacy executor selection; separate `external_operations` and `integration_operations`; business-stage `workflow_states`; voice `pending_confirmations`; legacy communication/contact summaries; appointment/service-visit and inventory/warehouse overlaps; lead/household dual-write; additive pgvector/Zep memory; bounded authenticated manual operational mutation routes; and projection-only frontend/read models.

The authenticated manual route seam is deliberately explicit. It is outside the natural-language DomainAction compiler today. Retrofitting it into BusinessEffects would change current semantics and therefore belongs to a later approved migration, not this freeze.
