# Voice-Orchestration Contract

Finnor is ready for a dealer's real credentials only when this contract holds. A
provider integration is an adapter at the edge of the system; it must not be the
place where identity, approval, recovery, or business logic is decided.

## The required path

```text
verified voice event
  -> resolve caller + tenant + role
  -> bind a durable call session
  -> understand intent using tenant memory and policy
  -> collect missing details or state an unambiguous confirmation
  -> create a tenant-scoped action and immutable audit episode
  -> atomically approve and claim the action
  -> execute idempotent provider operations
  -> reconcile the provider's actual outcome
  -> speak only the verified result, or a specific escalation
```

No transition may be inferred from a spoken sentence alone. Every transition is
owned by a durable record and is safe to resume after a process restart.

## Invariants

1. A voice event is accepted only after signature verification and replay
   protection.
2. The caller is resolved to exactly one tenant and permitted role before the
   planner receives the instruction. Unknown, ambiguous, or inactive identities
   are denied without exposing tenant information.
3. A confirmation can approve or reject only the action IDs explicitly presented
   to that same authenticated voice session. It can never mean "the newest pending
   actions for this tenant."
4. An unclear utterance, an expired call session, a changed caller number, or a
   missing identity leaves every action pending.
5. A side effect is represented by a stable operation key and an idempotency key
   supplied to the provider where that provider supports one. A process crash
   between send and response produces reconciliation work, not a blind resend.
6. "Done" is spoken only after the required provider result has been recorded and
   verified. Timeouts and uncertain outcomes are described as uncertain and sent
   to recovery/review.
7. Planner, critic, transcript, logs, and observability data receive minimized,
   redacted data. The durable business system retains the original data only where
   the action requires it.
8. Each action type declares: required details, confirmation rule, authorized
   roles, provider operation(s), success evidence, retry rule, recovery action,
   and a deterministic simulator contract.

## Current baseline and work remaining

Already present: tenant-scoped actions and policies, database-enforced approval
states, action audit episodes, plugin validation/drafting/execution, an external
operation idempotency ledger, replay-protected Vapi ingress, retries/reflection,
and provider health reporting.

Not yet sufficient for a real voice-native business operating system:

| Capability | Current state | Completion standard |
| --- | --- | --- |
| Voice identity | Default tenant and owner identity are still used by Vapi ingress. | Persisted caller/assistant-to-tenant identity, role and lifecycle; unknown callers fail closed. |
| Confirmation scope | Live confirmation can select newest tenant-pending rows. | Durable call-session binding to exactly the presented action IDs and expiry. |
| Execution recovery | Completed operations are deduplicated; a crash can leave `executing` / `running` work unresolved. | Lease, reconciliation state, reaper, retry/dead-letter/escalation for every uncertain operation. |
| Provider truth | Adapter responses are the primary completion signal. | Action-specific success evidence and reconciliation queries/webhooks, including an `unknown` outcome state. |
| Capability maturity | Plugins exist, but their real-provider coverage varies. | Per-action provider-neutral contract, simulator, negative tests, and activation checklist. |
| Voice dialogue | Short-term session memory exists. | Durable call turn/session state for clarification, interruption, correction, timeout and handoff. |
| Release proof | Unit/integration tests and a local load check exist. | Adversarial transcript suite plus restart, duplicate, provider-failure, and reconciliation tests in staging. |

## Activation rule

Real dealer credentials are activated action-type by action-type, not globally.
An action type may be enabled only after its simulator and contract tests prove
the exact provider request, idempotency behavior, observed success evidence,
failure recovery, and spoken result. Until then its policy remains gated and its
setup status reports the missing dependency explicitly.
