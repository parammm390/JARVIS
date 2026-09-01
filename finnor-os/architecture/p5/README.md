# P5 branchable world runtime

P5 is a pure planning-time world predictor. It materializes a bounded immutable snapshot from existing canonical owners, forks that snapshot in memory, applies the same P1 `OperationalProgram` and P2 effect declarations as hypothetical overlays, expands P3-owned uncertainty without probabilities, and returns structured branch evidence to P4. P4 remains the only program selector. The existing Authority, BusinessEffect, Work/Objective, provider/computer, and governed execution runtimes remain the only authoritative commit path.

The implemented flow is:

```text
existing canonical truth / BusinessWorldProjection
  -> read-only bounded WorldSnapshot
  -> immutable WorldBranch forks
  -> same OperationalProgram
  -> fail-closed speculative adapters
  -> hypothetical effects + predicted observations/recovery
  -> complete bounded branch evidence
  -> P4 hard evidence gate + deterministic extraction
  -> existing governed runtime remains authoritative
```

## World contract

`packages/speculative-runtime/src/contracts.ts` defines tenant-bound `WorldSnapshot`, `WorldBranch`, `WorldVariable`, `HypotheticalEffect`, `PredictedObservation`, `BranchOutcome`, `SimulationBounds`, and `SimulationResult`. Snapshot materialization in `snapshot.ts` derives selectors from the program, P2 read/write declarations, Work references, predicates, and observations. Returned rows are projected again to the exact selector fields, unrequested rows and credential-like fields fail closed, and serialized snapshots are integrity-checked before interpretation. It does not scan or copy a database.

Snapshot, branch, overlay, hypothetical-effect, trace, and replay identities each use a P5-only hash prefix. They do not reuse BusinessEffect hashes, Work IDs, IR hashes, provider operation IDs, or idempotency keys. Non-semantic runtime metadata and wall-clock timing are excluded.

## Interpreter and adapters

`interpreter.ts` supports every current Operational IR primitive: Query, Effect, Wait, Compensation, Sequence, Parallel, Branch, Observation evaluation, and SuccessCondition evaluation. Unsupported effect meaning fails explicitly. The closed adapter inventory is canonical read, canonical write overlay, communication, financial effect, provider mutation, computer mutation, wait/event, and observation. Every adapter returns hypothetical evidence only; no adapter accepts a production callback.

External success, failure, retryable failure, partial, ambiguous, timeout, stale-precondition, and unknown outcomes are modeled explicitly. A generic partial result never applies the full intended state. Ambiguous delivery requires reconciliation and remains `UNKNOWN`. Effect-verification observations remain `UNKNOWN` until the real runtime observes them; P5 creates no DecisionReceipt.

## Bounds and isolation

Every simulation requires positive `maxBranches`, `maxDepth`, `maxEffects`, `maxSimulationSteps`, `maxSimulationMs`, and `maxMemory`. Branch expansion computes the full Cartesian branch requirement before execution. If the branch/depth budget cannot cover every modeled alternative, P5 returns `BOUNDED_INCOMPLETE` with zero pruned branches and zero discarded high-risk branches. Runtime time is a deterministic operation-unit budget, preventing wall-clock nondeterminism.

The P5 package has only downward dependencies on shared types, Operational IR/P2, and P3. Import-boundary tests prohibit DB, P4, orchestration, Authority, Work, provider, computer, network, environment, process, clock, and persistence primitives. Cross-tenant state and variables fail closed, parents are frozen, and overlays are branch-local copies.

## P4 loop and shadow scope

P4 exposes a narrow evidence callback rather than depending on P5. When `simulationPolicy` is `REQUIRED`, P4 first preserves P3, P2, dependency, solver, budget, and existing-runtime lowering gates; it then requires complete P5 evidence with zero real side effects, full branch coverage, valid ownership, and no simulated hard-constraint violation. Conservative worst-branch evidence influences P4's existing lexicographic extraction. P5 never returns a winner.

The production integration is shadow-only and is limited to an already-completed authoritative operational query. It materializes a redacted bounded observation, runs P5, records comparison evidence through the existing P4 shadow receipt/CausalReplay seam, and returns the authoritative query execution by object identity. CausalReplay receives structured snapshot provenance, program graph, assumption references, hypothetical effect descriptors, predicted observations, branch outcomes, and recovery paths; raw assumption/effect values and reasoning are excluded. It adds no approval, Work, provider/computer call, persistence write, or route change.

## Final lineage

The original P5 source tree at `baa777e8caedaaf09fdfde5f6e901393b90c201f` is reconciled exactly once onto the final production-infrastructure descendant. Final certification is `PASS_FINAL_DESCENDANT_LINEAGE_SHADOW_ONLY`: this certifies the artifact and its immutable ancestry, not authority to execute simulations as reality. P5 remains speculative and shadow-only.

The production release boundary is recorded in `production-release-boundary.json`. The exact pre-change ownership inventory, hard gates, corpus identity, and deferred seams are recorded beside this document.
