# Phase 5 — Operational Time Machine and Causal Replay Certification

Certification date: 2026-08-23
Repository: FINNOR / `finnor-os`
Migration head: `0095_phase5_causal_replay.sql`

## Certification decision

**Phase 5 implementation and local deterministic certification: PASS.**

**Final five-phase production 10X certification: BLOCKED — not yet earned.** The complete implementation, clean-database upgrade certification, causal correctness suite, unit suites, typechecks, production build, action inventory, and focused desktop/mobile UI proof pass. An unqualified production certification still requires deployed release evidence from a clean release identity and resolution or explicit acceptance of the broad Playwright golden-frame regressions listed below. No production deployment or live provider action was performed as part of this certification.

This is an evidence limitation, not a hidden pass. The system can be released for an environment certification run, but this document does not claim that an unobserved deployment is healthy.

## Delivered system

Phase 5 adds a tenant-bounded, GET-only causal replay for durable Work. From a single Work it reconstructs the recorded trigger, immutable decision-time context, planning and dependency topology, historical policy and authority, approvals, provider execution, callbacks, waits and wakes, exact canonical changes, verification, receipts, failures, recovery, compensation, and retained artifacts.

The replay is a projection over durable facts. It does not rerun the planner, providers, reconciliation, objectives, or lifecycle code. It does not expose prompts, chain-of-thought, memory contents, credentials, raw provider payloads, or mutation controls.

The user-facing entry point is **Why did this happen?** in the Work causal spine. It opens a lazy-loaded Operational Time Machine with:

- a deterministic natural-language explanation;
- a semantic timeline and range scrubber;
- governance, execution, outcome, and failure/recovery filters;
- evidence availability, integrity hashes, and exact causal-link inspection;
- comparison of immutable decision-time context with later canonical changes;
- explicit legacy, restricted, expired, unavailable, and truncation states;
- a persistent read-only/no-side-effects guarantee.

## Durable contracts and provenance

Migration `0095_phase5_causal_replay.sql` adds bounded immutable provenance:

| Record | New provenance | Integrity and mutability |
| --- | --- | --- |
| `work_inputs` | `context_snapshot`, `context_snapshot_hash`, `context_captured_at` | SHA-256, all-or-none, JSON object, 64 KiB maximum, update trigger prevents modification |
| `work_planner_attempts` | `decision_context_snapshot`, `decision_context_hash`, `decision_context_captured_at` | SHA-256, all-or-none, JSON object, 64 KiB maximum, update trigger prevents modification |

The decision snapshot is captured before planning and contains only bounded operational provenance: interaction context, selected/referenced Company Graph entities, cohort receipt, canonical evidence references and summary hashes, authority revision/roles, and completeness health. Legacy planner paths derive and preserve the durable employee authority revision when a rich interaction context is unavailable.

The public replay contract is versioned and bounded:

- node stages from trigger through context, governance, execution, outcome, and recovery;
- edges marked `proven` or `missing`, with evidence references and a human explanation;
- ordered moments, deterministic explanation, completeness, role-aware viewer scope;
- limits of 1,000 nodes, 2,000 edges, 2,000 action events, and 500 computer artifacts;
- `mode: read_only`, `method: GET`, `mutationControlsIncluded: false`, and `sideEffectsPossible: false`.

## Causal correctness rules

The projection enforces these invariants:

1. Tenant scope is applied to the Work root and all evidence reads. Cross-tenant requests return not found.
2. Policy and authority use the exact recorded policy version and authority revision, not the tenant's current settings.
3. Parallel DAG branches stay parallel. Dependency edges are created only from persisted `depends_on` relationships.
4. Canonical business changes are linked only by exact durable identifiers and correlation fields; no timestamp or text-based fuzzy join is used.
5. Missing provenance is represented by an explicit missing node/edge or completeness gap. The projection does not invent causality.
6. Repeated GETs preserve causal facts and do not change Work, jobs, actions, or lifecycle state.
7. Technician evidence is restricted and sanitized; owner views may expose allowed operational facts but never secrets or executable provider material.
8. Artifact content follows retention. Expired or restricted content is labelled while safe metadata and integrity references remain visible.

## Test and performance evidence

### Phase 5-specific evidence

| Proof | Result |
| --- | --- |
| Real-PostgreSQL causal replay integration | 4/4 passed |
| Flagship causal graph | 39 nodes, 46 edges, all 46 edges proven; 90 ms warm / 351 ms earlier cold run |
| Large-history bounded projection | 240 source actions → 962 nodes / 721 edges; 58 ms warm / 495 ms earlier cold run |
| Immutability, deterministic repeated GET, and zero-state-mutation assertions | Passed |
| Tenant isolation, technician redaction, and retention states | Passed |
| Legacy incomplete-history behavior | Passed |
| Time Machine pure model unit tests | 3/3 passed |
| Time Machine production component tree in Playwright | 2/2 passed: desktop Chromium and mobile 375 px |

The focused browser proof opens the real Work component tree, loads replay only after the entry is opened, scrubs to an earlier moment, filters governance facts, exposes restricted evidence truthfully, checks mobile horizontal containment, and verifies that no approval/retry/cancel/compensation control appears inside the Time Machine.

### Cross-phase regression evidence

| Suite | Result |
| --- | --- |
| Backend unit | 90 files / 498 tests passed |
| Frontend unit | 64 files / 552 tests passed |
| Backend and frontend TypeScript | Passed |
| Next.js production build | Passed, 53 pages |
| Action manifest | 59/59 actions passed |
| Policy coverage | 59/59 actions green |
| Authorization matrix drift check | Passed after regeneration |
| Clean-database Upgrade 10 certification | 4 files / 34 tests passed; report status `PASS` |
| Broad real-PostgreSQL integration | 153 files / 765 tests initially green; 3 environment/head failures remediated and their affected 3 files / 11 tests rerun green; 4 configured live tests skipped |

The clean-database release proof applied all 96 migrations from `0000` through `0095`, used the restricted application role, and certified eight cross-phase journeys. Its recorded metrics include:

| Journey metric | Result |
| --- | --- |
| Voice/text handoff, approval, completion | 1,090 ms; stale-state convergence 19 ms; 7 canonical queries; 0 duplicate side effects |
| Durable operation partial-failure recovery | 139 ms; 0 duplicate side effects |
| Waiting objective restart/resume | 290 ms; 1 recovery enqueue; 0 duplicate continuation jobs |
| Cross-projection business change | 32 ms across 5 projections; 0 duplicate side effects |
| Provider failure safe recovery | 219 ms; 3 attempts; 0 duplicate side effects |

All recorded objective-completion checks were correct. The machine-readable evidence is `docs/release/generated/upgrade10-whole-system-certification.json`.

## Broad browser status

The first broad Playwright run had 158 passed and 5 failed before the remaining project-guarded cases were reported skipped. It exposed a mobile helper-label assertion in the Work test, two transient dev-server failures, a stale source-honesty count, and one visual baseline drift.

After correcting the semantic mobile assertion, a clean broad rerun completed with **161 passed, 161 intentionally skipped by project guards, and 2 failed**. The operational-deltas proxy and P1 fixture exit gate passed on the clean run. Of the two remaining failures:

- The Phase 3 fleet test expected the historical literal “44 registered actions,” while the generated authoritative manifest and rendered UI correctly report 59. The assertion was updated to 59 and its focused rerun passed (1 passed, 1 project-guarded skip).
- The signed-out 390 px public-preview visual differs on 6% of pixels against a 2% threshold. Inspection shows the current pre-existing mobile header composition is 132 px/two-row while the stored golden expects the earlier 108 px/inline layout. That source change is outside Phase 5 and was preserved; the screenshot was not rewritten.

The focused Time Machine browser contract also passes in both projects. The one unresolved public-preview golden requires the owner to accept the current layout and intentionally update the baseline, or restore the earlier mobile header composition. It remains a blocker to an unqualified all-UI certification.

## Known limits

- Work created before migration `0095` cannot acquire an exact historical context snapshot retroactively; it is labelled `legacy_incomplete`.
- The projection compares a captured decision context with exact correlated later changes. It does not reconstruct an arbitrary full-database snapshot at every timestamp.
- Artifact content may expire or become restricted under retention policy. Safe metadata and hashes remain when permitted.
- `asOf` is request time and can change between reads; recorded nodes, edges, and explanations remain deterministic for unchanged durable data.
- Production release identity, deployed migration parity, live provider health, and production telemetry were unavailable in this local workspace.

## Release gate

To convert `BLOCKED` to an earned final five-phase production certification:

1. run the release verifier from a clean source revision with `FINNOR_BUILD_ID`, `FINNOR_VERSION`, `FINNOR_ENVIRONMENT`, and `FINNOR_RELEASE_SOURCE` set;
2. verify deployed API/worker migration parity at `0095_phase5_causal_replay.sql`;
3. run the live smoke/telemetry checks allowed by that environment without approving or sending real customer-impacting actions;
4. resolve or formally accept the remaining broad Playwright golden/dev-server regressions and attach the final complete run.

Until those artifacts exist, the accurate statement is: **Phase 5 is implemented and locally certified; the final deployed five-phase 10X certification is not yet earned.**
