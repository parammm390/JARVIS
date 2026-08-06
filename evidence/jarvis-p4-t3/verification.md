# P4.T3 verification — LF-11/LF-12 and duplicate-event protection

Implemented and source-verified:

- `LiveRunRow` marks only an actually leased step as the current flow target; pending steps remain quiet.
- Leased-edge speed uses the real LIVEFRAME energy value and maps 1.4 s → 0.8 s; real recent step throughput controls only particulate count.
- Completed checks/shockwaves are mounted for a real status transition, not for a completed step first observed on mount. The local spark CSS duration is 340 ms; reduced motion is static.
- `shouldEmitStatusTransition()` rejects first observation, same-status repeats, wrong target status, and the same transition key. A shared provider ledger is used by the fast and medium reconciliation lanes.
- Completion/failure sound cues are scoped to the currently linked run/step IDs.

Verification:

- Focused Phase 4 run: **6 files / 57 tests passed**.
- Full unit run: **37 files / 412 tests passed**.
- Root TypeScript, lint, and `git diff --check`: passed.

Deviation/blocker: no authenticated live leased→completed recording or measured event→pixel timing was available. Browser bootstrap failed with `Cannot redefine property: process`; no FPS or browser animation assertion is claimed.
