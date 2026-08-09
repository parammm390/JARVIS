# P1.T3 verification — H0–H6 Scene Director

## Source-coupled implementation

- `src/components/jarvis/kernel/scene-director.ts` is a pure presentation projection over the existing `LiveFrameProjection`; it does not introduce a business state machine, timers, backend data, or a second truth store.
- `ThreadBridge.tsx` exposes the seven scene markers and composes the existing Orb, causal thread, approval cockpit, command path, operational rails, and Business Pulse according to that projection.
- Active sentinel scenes hide only the redundant Orb readout subtree at the presentation layer. Source-backed operational facts remain in the context/review rails. The existing Orb core is compacted at the sentinel scale.
- `OperationalConsole.tsx` keeps one visible `[data-primary-status]`: Ready/Listening use the Orb readout; active scenes use the source-backed context rail.

## Scene and responsive evidence

`after-metrics.json` records all seven scene projections and the measured desktop geometry. The 21 PNGs in this directory cover every fixture at 1440×1000, 768×1024, and 390×844. The latest DOM capture reported:

- all seven scenes resolve to distinct `data-command-canvas-scene` / `data-scene-*` markers;
- one primary status in every fixture;
- no horizontal overflow at 1440, 768, or 390;
- Ready ambient Orb subtree has zero infinite CSS animations;
- active scene Orb sizes are 88px desktop/tablet and 76px mobile, while the Ready Orb measures 259px/260px/240px;
- the wide Plan causal spine measures 737px, within the specified 680–760px causal reading width.

## Truth boundaries

- `?fixture=listening` is a visibly labelled, dev-only QA frame signal (`micOpen: true`) because the existing fixture data had no listening input. It contains no instruction, run, receipt, or backend result.
- `?fixture=recovery` uses the existing kernel trace transition to `TRACE_failed`; it does not invent a workflow result or receipt.
- The unsigned fixture produces expected 401 resource errors for approval/receipt/recovery. They are filtered as expected environment errors; unexpected console errors and page errors are empty.
- The fixture has `showRail={false}` and no real action-linked workflow run, so no fake command dock interaction or fake Execution Weave is claimed. Production paths remain source-coupled and gated by real auth/run truth.

## Verification commands

```text
npx tsc --noEmit                         pass
npm run lint                             pass
npx vitest run ...                       3 files / 48 tests pass
git diff --check                         pass
```
