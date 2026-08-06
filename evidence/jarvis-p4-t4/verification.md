# P4.T4 verification — LF-13/LF-14

Implemented and source-verified:

- Failed step edges use a static red fractured edge and the node uses a local ≤4 px / 160 ms fault cue; the page is not shaken.
- Blocked action IDs remain visibly blocked before a workflow run exists and are counted separately from unobserved actions.
- Compensating edges use amber reverse flow along the actual step order; compensated edges settle as static amber, with literal `Rolling back` / `Rolled back` labels.
- Run presentation keeps failed, cancelled, escalated, and recovery run states distinct. Real run controls remain available only for their source-supported current states.
- Failure reason, attempts, observed time, receipt availability, and the relevant step control remain available through the bounded evidence surface.

Verification:

- Focused Phase 4 run: **6 files / 57 tests passed**.
- Full unit run: **37 files / 412 tests passed**.
- Root TypeScript, lint, and `git diff --check`: passed.

Deviation/blocker: no authenticated failure/compensation recording was available, and no production state was changed. The checked-out backend has no separate blocked-step status; the UI therefore does not invent one.
