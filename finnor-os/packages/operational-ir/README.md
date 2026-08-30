# `@finnor/operational-ir`

`@finnor/operational-ir` is FINNOR's typed, deterministic planning language. It
describes desired operational computation above the existing governed execution
substrate; it does not own or replace that substrate.

```text
human intent
  -> existing routing / context / grounding
  -> OperationalProgram
  -> static validation / compatibility lowering
  -> existing DomainAction or ObjectiveDecision or OperationalQueryRequest
  -> existing BusinessEffectSet
  -> existing authority / approval / Work
  -> existing execution / observation / verification / replay
```

## Semantic boundaries

The following objects have deliberately separate identities and meanings:

```text
Operational IR Effect
  != BusinessEffectSet
  != provider operation
  != execution receipt
  != Work
```

An IR `Effect` is an intended state transition for planning. `BusinessEffectSet`
remains the immutable consequential execution contract independently compiled by
the existing compiler. Authority remains runtime authority; Work/Objective remain
durable lifecycle truth; existing observation, reconciliation, and causal replay
remain execution truth.

The IR hash uses the tagged `ir:sha256:<64-lowercase-hex>` domain. It is never a
BusinessEffect hash, idempotency key, provider operation id, DomainAction id, or
Work id. The compatibility lowerer has no API that can derive those identities.

## Contract

Every `OperationalProgram` contains:

- `irSchemaVersion`, `compilerVersion`, `provenance`, and `irSemanticHash`;
- one desired-state `Goal` and one `SuccessCondition`;
- explicit `Constraint[]`, `EntityRef[]`, bounded include/exclude `scope`, and
  `Observation[]`;
- optional `Budget`;
- a structural body composed from `Query`, planning-level `Effect`, `Sequence`,
  `Parallel`, `Branch`, `Wait`, and `Compensation`.

Constraints are exactly `HARD` or `SOFT`. A statically known violated HARD
constraint is rejected; it is never converted into a score. Entity references
are `resolved`, `unresolved`, or `ambiguous`. They contain canonical entity
identity but have no tenant-ownership field. Trusted runtime context is the only
source of tenant identity.

Observations declare `verificationFloor: "EXISTING_OR_STRONGER"`. This is a
schema-level floor: IR can require additional evidence, but cannot declare weaker
verification than the existing BusinessEffect/Objective substrate.

## Canonical serialization and semantic hash

`canonicalSerialize` accepts deterministic JSON values only. It:

- sorts object keys lexicographically;
- preserves array order by default;
- emits `-0` as `0`;
- rejects `undefined`, non-finite numbers, `Date` objects, functions, symbols,
  bigint values, and cyclic object graphs.

Before hashing, `canonicalizeIrSemanticValue` excludes root runtime-only material:
`compilerVersion`, `provenance`, `nonSemantic`, and `irSemanticHash`. It sorts only
fields whose contract is set-valued: constraints, entities, observations,
references, targets, dependencies, parallel branches, commutative `all`/`any`
predicates, and `ALL` success criteria.

Meaningful order is retained. In particular, `Sequence.steps` and FIRST_MATCH
`Branch.cases` are never sorted. `irSchemaVersion` and the complete semantic AST
remain in the projection. The UTF-8 canonical JSON is hashed with SHA-256 and
tagged as `ir:sha256:<hex>`.

## Pure static validation

`validateOperationalProgram` validates only P1 structural/static semantics:

- strict schema, required fields, hash integrity, and forbidden tenant selectors;
- duplicate semantic ids and invalid predicate/entity/query/effect/observation refs;
- malformed, duplicate, self, or cyclic dependencies;
- known HARD violations and SOFT warnings;
- unresolved consequential targets and grounded target/payload mismatch;
- observation/evidence references and required goal-observation participation;
- FIRST_MATCH branch duplicates, compensation links/order, route/body shape, and
  declared budgets.

It does not query a database, ground an entity, authorize, execute, search for a
program, solve global legality, choose a provider, or mutate state.

## Adapter matrix

| Actual representation | Existing -> IR | IR -> existing | Boundary |
| --- | --- | --- | --- |
| `HumanOperation` | `UNSUPPORTED` | `UNSUPPORTED` | No such production symbol exists at the audited baseline. |
| `InstructionRouteDecision` | `LOSSY` overall | `NOT_APPLICABLE` | Route/version/reasons are lossless without `queryDecision`; QUERY decisions require the separate Query adapter. It cannot fabricate desired-state semantics. |
| planner `DomainAction[]` / `DomainAction` | `LOSSY` | `LOSSY` | Explicit same-candidate Goal/effect/observation semantics and trusted runtime ids are required. |
| `BusinessEffectSet` | `LOSSY` comparison projection | `NOT_APPLICABLE` | Never reconstructed from IR; its ids/hashes remain downstream-owned. |
| `ObjectiveDecision` | `LOSSY` | `LOSSY` | One bounded query/action/wait decision only; terminal controller state remains Objective-owned. |
| `OperationalQueryRequest` | `LOSSLESS` | `LOSSLESS` | Embedded tenant-less request; execution remains in the Operational Query Plane. |

Adapters return one of `LOSSLESS`, `LOSSY`, `NOT_APPLICABLE`, or `UNSUPPORTED`
with explicit preserved and omitted fields. They never synthesize absent Goal,
observation, success, grounding, authority, or lifecycle semantics to force a
round trip.

`adaptExistingPlanningCandidateToProgram` is the single assembly seam for the
audited route result, `DomainAction`, and `ObjectiveDecision` shapes. It requires a
complete desired-state envelope from the same parsed candidate/current context.
Route classification or `actionType` alone returns `UNSUPPORTED`; conversation
returns `NOT_APPLICABLE`.

## Compatibility lowerer

The lowerer produces an in-memory plan only:

- QUERY -> the existing `OperationalQueryRequest`;
- ATOMIC_EFFECT / KNOWN_ACTION_COMPATIBILITY -> draft `DomainAction` plan using
  tenant/action/timestamp provenance exclusively from `TrustedLoweringContext`;
- single query/action/wait OBJECTIVE -> one existing `ObjectiveDecision`;
- multi-step Sequence/Parallel/Branch/Compensation OBJECTIVE -> `UNSUPPORTED`
  until a later phase owns program execution/search semantics.

It preserves an IR sidecar containing the Goal, HARD constraints, expected
observations, success condition, provenance, and IR hash. The returned invariant
flags prove that it does not authorize, execute, persist, select a provider,
compile a BusinessEffect, derive idempotency, bypass grounding, or weaken
verification.

## Semantic diff and pure shadow mode

Semantic comparison normalizes and compares execution model, canonical targets,
scope/exclusions, Goal, effect intent, dependencies, HARD constraints, required
capabilities, expected observations, success condition, compensation, and
consequential classification. It does not compare raw artifact JSON.

Results are exactly `EQUIVALENT`, `EXPECTED_IMPROVEMENT`, `REGRESSION`,
`LEGACY_UNSUPPORTED`, `IR_UNSUPPORTED`, or `FIXTURE_INVALID`. Only additive
exclusions, HARD constraints, and observations can be an expected improvement;
all other mismatches are regressions.

`runPureShadowCompilation` accepts only an already-produced candidate fingerprint
and IR program. There is no model/compiler callback, so a comparison cannot make a
second stochastic call. Its authoritative path is always `EXISTING`, and every
mutation counter is a frozen literal zero.

`runPureShadowCandidateCompilation` adds the actual adapter step: the exact
existing route/planner/controller candidate plus its explicit same-candidate
semantic envelope becomes IR, is validated, is compatibility-lowered, and is
semantically compared. Unsupported and conversation seams are recorded without
constructing an executable program.

## Dependency boundary

Production code imports only `@finnor/shared-types`, `zod`, the Node SHA-256
primitive, and package-relative modules. Automated tests fail for a forbidden
import, a reverse `shared-types -> operational-ir` edge, or any internal package
cycle. The package has no DB, orchestration, authority, workflow-runtime, domain
plugin, read-model, tool/provider, computer, API, or frontend dependency.
