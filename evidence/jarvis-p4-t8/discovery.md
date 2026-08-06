# P4.T8 discovery — performance evidence boundary

The plan requires six-lane FPS p95, event→pixel timing by transport class, initial JS budget, five cold Lighthouse runs, and input/CLS checks. At discovery there was no completed P4 six-lane browser recording or linked-run metric artifact.

## Runtime surfaces checked

- Production `/jarvis/next`: HTTP **404**.
- Production `/jarvis`: HTTP **200**, but the authenticated command-center route rendered no instruction action-ID scope, graph, or run-status node at 1440×1000, 768×1024, or 390×844. Its real `GET /api/jarvis/workflows/runs` returned HTTP **200**, but the route does not connect those tenant-wide runs to a current instruction.
- Local `/jarvis/next?fixture=execution`: dev-only labelled Thread fixture. It initially had no linked run; the fixture harness was then wired to consume the same `KernelProvider` selector bridge, allowing an intercepted workflow GET to exercise the real six-node `WorkflowTheater` without creating a business event.

## Source boundary added for measurement

- `kernel/execution-metrics.ts` records a real status event only after the shared data poller accepts a deduplicated terminal transition, and closes it on the next browser frame in which the matching node/run is visible.
- `transport` is explicit. Current workflow status delivery is **poll**; no workflow SSE delivery path is present in this worktree, so no SSE sample is claimed.
- Browser inspection is ephemeral at `window.__jarvisExecutionPixelMeasurements`; the module has no business-state authority.
- The linked workflow path defers the expensive cinematic atmosphere and particle canvas while a real linked Weave is visible. Node-level backdrop blur was removed from the six-lane graph; the node background remains opaque.

The fixture evidence below is explicitly fixture evidence. It does not close the real linked-workflow, production bundle, Lighthouse, or Phase 4 FPS gates.
