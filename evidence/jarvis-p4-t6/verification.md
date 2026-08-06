# P4.T6 verification — bounded step evidence

Implemented and source-verified:

- Selecting a real graph node opens a bounded evidence drawer without navigation or Thread replacement.
- The drawer presents human-readable type/status, attempts, last observed time, terminal reason when present, and a receipt state.
- Receipt lookup is on demand by the real `workflowStepId`; missing/error lookup renders `No receipt has landed for this step yet.`
- The drawer contains no raw JSON, focuses its Close control, and closes by button, backdrop, or Escape.

Verification:

- Full unit run: **37 files / 412 tests passed**.
- Root TypeScript, lint, and `git diff --check`: passed.

Deviation/blocker: no authenticated linked run was available to exercise the drawer in a live browser, so no runtime receipt result is claimed.
