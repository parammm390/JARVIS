# P4.T5 verification — Weave composition

Implemented and source-verified:

- Desktop uses an optional `ThreadExecutionWeave` right plane only when the current instruction has a scoped observed run; the action spine keeps its execution signal.
- Tablet/mobile use the same `WorkflowTheater` inside the Thread document plane.
- Mobile hides the desktop SVG and restacks the real server-provided step order as a vertical causal rail, with red/amber rail semantics for observed failure/compensation states.
- The LIVEFRAME projection retains linked terminal run IDs without turning them into active work, so a verifying thread can compose a settled linked theater when a real run exists.

Verification:

- Full unit run: **37 files / 412 tests passed**.
- Root TypeScript, lint, and `git diff --check`: passed.
- Existing labelled lifecycle fixture regression at 1440 px, 390 px, and 390 px reduced motion: **3/3 passed**.

Additional bounded labelled fixture DOM fallback: 1440×1000 correctly withheld the optional right plane with no linked run; 768×1024 and 390×844 rendered the document-plane action-ID scope and explicit waiting state for six fixture actions. All three widths reported equal document/client widths and zero `pageerror` events.

Deviation/blocker: no current-worktree authenticated screenshots or DOM measurements for the required P4 1440/768/390 linked-run surface were obtained. The lifecycle fixture is labelled fixture support and is not live workflow proof.
