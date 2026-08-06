# P1.T7 route-isolation audit

Date: 2026-08-02  
Scope: canonical `/jarvis` only; `/demo` was not edited or exercised.

## Source ownership

- `src/app/layout.tsx:5,135` mounts `GlobalChrome` around the route tree.
- `src/components/layout/GlobalChrome.tsx:15-17` returns the route children directly when the pathname starts with `/jarvis`.
- The marketing-only branch at `src/components/layout/GlobalChrome.tsx:19-27` mounts `SmoothScroll`, `ParticleNetwork`, `CustomCursor`, `ScrollProgress`, `GrainOverlay`, and `FinnorAIConcierge` only when that guard does not match.
- `src/app/jarvis/page.tsx:10-11` enters `PersonalizedHome`; its public/no-session and owner paths at `src/components/jarvis/PersonalizedHome.tsx:74,79` render `InstructionThreadBridge`, while the older `Bridge` is only the explicit `/jarvis/bridge` route.
- The current diff has no changed paths under `src/app/demo`, `src/app/dashboard-demo`, or `src/components/demo`; `git diff --name-only | rg '(^|/)(demo|dashboard-demo)(/|$)'` returned no matches.

The marketing imports appearing in `GlobalChrome.tsx` are source-owned by the non-`/jarvis` branch; they are not mounted for the audited route. JARVIS-owned canvases remain expected: the full-viewport `jarvis-ambient` canvas and the Presence Core canvas.

## Static audit result

`rg` over `src/app/jarvis`, `src/components/jarvis`, and `src/components/layout/GlobalChrome.tsx` found no mounted `/demo` route, concierge, mascot, or pet component in the canonical owner path. Existing `CustomCursor` references in legacy JARVIS files are not reachable from the canonical `PersonalizedHome → InstructionThreadBridge` branch and are absent from the rendered DOM below.

## Rendered audit result

Evidence files:

- `route-isolation-1440x1000.{png,dom.txt,metrics.json,console.json}`
- `route-isolation-768x1024.{png,dom.txt,metrics.json,console.json}`
- `route-isolation-390x844.{png,dom.txt,metrics.json,console.json}`

At all three viewports, the rendered route reported:

- one visible `data-primary-status` with text `Ready`;
- zero visible mascot/pet selectors;
- zero visible concierge selectors and zero concierge marketing strings;
- no `data-custom-cursor` document attribute and zero cursor markers;
- zero `/demo` links and zero demo markers;
- zero images;
- one `data-jarvis-thread` root and one environment label;
- zero console errors. The only non-info entry was the existing `THREE.Clock` deprecation warning.

The mobile capture is a 382×827 JPEG artifact from the CSS 390×844 viewport because the visible scrollbar reduces the browser content width; its metrics record the exact 390×844 viewport and no horizontal overflow. The previously recorded 877 px mobile document height remains outside this route-isolation task.

## Verdict

**P1.T7 route isolation: verified.** No mascot, marketing concierge, custom cursor, demo chrome, or `/demo` modification was found for the canonical `/jarvis` surface. No product source was changed for this task.
