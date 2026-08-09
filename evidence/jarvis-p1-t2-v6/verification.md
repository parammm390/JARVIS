# P1.T2 verification

- `npx tsc --noEmit` — pass.
- `npm run lint` — pass with no warnings or errors.
- `npx vitest run src/components/jarvis/bridge/OperationalConsole.test.ts` — 2/2 pass.
- `npx vitest run src/components/jarvis/kernel/liveframe.test.ts` — 35/35 pass.
- Labelled `/jarvis?fixture=rest` captures at 1440×1000, 768×1024, and 390×844 — no console errors or page errors; viewport width equals document scroll width at every capture.
- Ready DOM assertion — exactly one `[data-primary-status]`; no `[data-jarvis-operational-context]`; four compact Business Pulse items; Now Rail groups are source-derived and capped at three.
- Ambient scan — no infinite CSS animation names within the Ready ambient Orb subtree.

## Honest limitation

The existing dev-only fixture deliberately passes `showRail={false}` because it has no authenticated kernel submission path. Therefore the screenshot metric for `commandDock` is `null`; production `ThreadPage` still mounts the existing `CommandRail` when `showRail` is true, and no authenticated owner session was available in this environment. No synthetic session or fake interaction state was introduced for evidence.
