# P4.T2 verification — LF-09/LF-10

Implemented and source-verified:

- The decision success boundary is `await jarvisPost(...)` → `recordDecision(...)` → success sound/haptic/stamp/ghost/beacon/flight effects.
- `recordDecision` emits `{verb, actionId, authoritative: true}` only after that boundary.
- `authoritativeDecisionWave()` rejects non-authoritative details and maps confirm/reject/escalate to green/red/amber.
- Thread atmosphere draws LF-09 only when the authoritative event and real DOM anchors exist; the full-motion duration is 520 ms and reduced motion settles semantically.
- The theater observes the first newly scoped run and emits LF-10's 300 ms connection path/chip. Existing runs on initial mount do not replay ignition.

Verification:

- Focused Phase 4 run: **6 files / 57 tests passed**.
- Full unit run: **37 files / 412 tests passed**.
- Root TypeScript, lint, and `git diff --check`: passed.

Deviation/blocker: the required authenticated decision→linked-run recording and 1440/768/390 DOM assertion were unavailable. The in-app Browser bootstrap returned the exact environment error `Cannot redefine property: process`; the local `/jarvis` HTTP smoke returned 200 but is not DOM/authenticated workflow evidence.
