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
| Voice identity | Phase 14: `VapiWebhookSchema`'s `call` object now round-trips `customer.number`/`phoneNumberId` (previously silently stripped by zod's default unknown-key behavior — see `webhooks/vapi/route.ts`'s `resolveTenantFromCall`), and `tenant_phone_numbers` resolves the tenant from the DIALED number instead of a single hardcoded default. Caller-to-tenant identity resolution (`resolveVoiceIdentity`) and fail-closed unknown callers were already in place from an earlier phase; this phase fixed the schema bug that kept them from ever running with real data, and added multi-tenant routing on top. | Met for single- and multi-line deployments; still open: staff (dispatcher/technician) caller identity remains unresolvable (no phone column on `users`), a named non-goal noted in the code. |
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

## Interruption / barge-in (Phase 14)

Vapi handles barge-in at the platform/assistant level — there is no custom
interruption code in this repo, and none is planned. This section documents what
governs it, so a dealer complaint like "it kept talking over me" or "it stopped
mid-sentence for no reason" has a known first place to look.

**The two settings that matter**, per Vapi's current docs
([Speech configuration](https://docs.vapi.ai/customization/speech-configuration),
fetched 2026-07-18):

1. **`stopSpeakingPlan`** — the assistant-level control for when a caller's speech
   is allowed to cut the assistant off mid-sentence. Fields and Vapi's own
   defaults:
   - `numWords` (integer, default `0`) — how many transcribed words the caller
     must say before the assistant stops. `0` means interruption is triggered by
     raw voice-activity detection (fast, more prone to false triggers from
     background noise); `2`–`3` waits for a couple of confirmed words
     (transcription-based, slower but more deliberate — fewer accidental
     cutoffs from a cough or "uh").
   - `voiceSeconds` (default `0.2`) — how long sustained voice activity must
     last before it counts as an interruption attempt.
   - `backoffSeconds` (default `1`) — how long the assistant stays silent after
     being interrupted before it's allowed to speak again.
2. **Transcriber endpointing** — the turn-detection method (Vapi's own
   text-based default, or a swappable provider — Krisp audio-based with a
   configurable 0–1 threshold, Deepgram Flux/Assembly with native turn
   detection, or LiveKit's text-based `waitFunction`) that decides when the
   caller has finished a turn at all; this interacts with `stopSpeakingPlan`
   but is a separate setting.

**What this repo can verify, and what it can't:** nothing in this codebase sets
`stopSpeakingPlan` or a transcriber endpointing override — grepping for
`stopSpeakingPlan`/`endpointing` across both the `finnor-os` and marketing repos
returns no matches, so the live assistant (id in `VAPI_ASSISTANT_ID`, currently
`59863f35-236e-4451-9cb8-cd8df4a3c440` per the marketing repo's
`useVapiSession.ts`) is running on whatever was last set directly in the Vapi
dashboard or left at Vapi's defaults above. This executor has no authenticated
access to the live Vapi dashboard, so the assistant's actual current values are
unverified here — invented values would be worse than none.

**The one required human step:** open the assistant in the Vapi dashboard and
confirm `stopSpeakingPlan` against the defaults above.

**Recommendation:** for Finnor's use case (a dealer's real customer describing a
water problem, or answering a yes/no gate confirmation), default-`0` VAD-based
interruption is likely too trigger-happy — a customer's "um" or background dog
bark can cut the assistant off mid-quote. Set `numWords` to `2`–`3` so a genuine
interjection ("wait—", "actually no—") reliably interrupts while incidental noise
doesn't, and leave `backoffSeconds` at the default `1` unless dealers report the
assistant restarting too abruptly after a real interruption.
