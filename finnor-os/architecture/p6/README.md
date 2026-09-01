# P6 — Trace Compiler and Procedure Induction

P6 is an offline, non-executing hypothesis compiler. It consumes existing governed FINNOR execution evidence and emits a frozen `ProcedureCandidate`; it does not create a replacement event log, persist authority, mutate Work, invoke providers/computers, enter P4 planning, or certify a program.

## Status and lineage boundary

- `P6_BASELINE_SHA`: `baa777e8caedaaf09fdfde5f6e901393b90c201f`
- P5 source SHA: `baa777e8caedaaf09fdfde5f6e901393b90c201f`
- P6 source SHA: `04360c912efd6f9c37e54d1b840255701e61a262`
- final lineage status: `PASS_FINAL_DESCENDANT_LINEAGE_OFFLINE_ONLY`
- P6 closure branch: `codex/p0-p6-production-closure`
- permitted integration: pure contracts, offline fixtures, evaluation, and stored/reported hypotheses only
- P5 and P6 reconciliation counts: exactly one each

## Data path

Existing `Work`, `BusinessEffect`, `ExecutionProjection`, `CausalReplay`, provider/computer, observation, authority, reconciliation, compensation, P3, P4, and labeled P5 evidence is adapted into `SourceTraceBundle`. Normalization performs semantic redaction before hashing, reconstructs explicit/equality-backed dataflow, preserves causal/control/authority/observation/retry/compensation/temporal edges, validates real completion semantics, and emits canonical `ExecutionTrace`.

Semantic alignment uses operation equivalence class, effect class, typed input/output interfaces, safety boundaries, and dependency structure. It does not use array position and does not encode provider SDK or UI details as business semantics. Anti-unification induces the least-general supported structure with deterministic ordering and tie-breaking.

## Conservative inference rules

- Positive real traces define the positive procedure body. Failure-only actions are retained as negative evidence and excluded from that body; negative predicates, observations, authority gates, reconciliation, compensation, and success requirements remain available as safety/recovery evidence.
- One trace cannot prove a constant. Public values repeated across at least two positive real traces may be candidate constants; tenant/private values remain parameters or bound values.
- Branches require at least two actually observed arms with one predicate identity. No unseen arm is fabricated.
- Loops require at least two positive real traces, each with at least two explicit structural iterations, a common iterator source, and a common termination condition.
- Automatic retry is emitted only for explicit idempotent safe retry or reconciliation-before-retry evidence. Ambiguous mutation retry remains `UNKNOWN` and non-automatic.
- Event-driven waits remain event-driven and fixed-duration waits retain observed durations.
- Authority requirements can be inferred, but every emitted requirement has `grantsAuthority: false`.
- External observations remain reality-dependent transitions; model decisions retain purpose/schema/constraints only, never prompt transcripts or chain-of-thought.

## Identity, privacy, and determinism

`p6:trace:sha256:*`, `p6:alignment:sha256:*`, and `p6:candidate:sha256:*` are separate identity domains from Work IDs, BusinessEffect semantic hashes, provider operation IDs, idempotency keys, Operational IR hashes, and P5 simulation trace IDs. Provenance retains mappings to those source identities.

PII, customer data, tenant-private values, credentials, and secrets are redacted before trace identity is computed. Secret literals receive no equality token. Exact governed identity mappings remain on tenant-bound Trace provenance, while a generalized candidate carries only domain-separated opaque references. Cross-tenant compilation is rejected unless explicit semantic anonymization is requested; generalized output contains typed placeholders, never source literals.

Fixed corpus, normalizer version, alignment version, anti-unifier version, seed, and clock produce byte-semantically equivalent output. No live provider, database, network, or model is required by the locked P6 corpus.

## Certification boundary

`ProcedureCandidate` is always `NON_EXECUTABLE_HYPOTHESIS`, `UNCERTIFIED_P6_HYPOTHESIS`, frozen, and `automaticPlannerInput: false`. P7 owns operating-region certification, safety proof, runtime admission, authoritative persistence/cutover, and any eventual executable Operational IR conversion.
