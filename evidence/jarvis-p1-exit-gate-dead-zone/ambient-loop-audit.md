# P1 rest ambient-loop audit

Date: 2026-08-02  
Route: local canonical `/jarvis` public-preview rest branch  
Required gate: Plan P1 — exactly two ambient loops or fewer; at rest only LF-01 Presence Breath and Field drift may loop.

## Source inventory

Before the edit, `ThreadAtmosphere` mounted `ConsoleAtmosphere` and the dynamic `ParticleField` whenever low-power mode was off. `ConsoleAtmosphere` owns three infinite light-mass motions, one infinite caustic shimmer, and 14 infinite bubbles (`src/components/jarvis/atmosphere.tsx:51-83`). `ParticleField` owns a continuously repainting `onFrame(draw)` canvas with 48 drifting particles (`src/components/jarvis/panels/ParticleField.tsx:59-177`). Those are generic standing loops, not LF-01 or the source-backed Field drift.

The final source gates both owners behind `liveframe.mode !== "ready"` at `src/components/jarvis/bridge/ThreadBridge.tsx:219-233`. In `ready`, the Orb's Three.js frame loop is the allowed Presence Breath (`src/components/jarvis/bridge/Orb3D.tsx:303-354`); `ThreadField` is the single source-backed Field owner and renders only real count-driven points (`src/components/jarvis/bridge/ThreadField.tsx:34-57`). The grid is static (`src/components/jarvis/jarvis-theme.css:221-237`). Event cues and relight are event-triggered one-shots, not standing loops (`ThreadAtmosphere.tsx:101-132`).

## Runtime evidence

The final rest captures are `rest-final-1440x1000`, `rest-final-768x1024`, and `rest-final-390x844` under this directory. All three report:

- `data-liveframe-mode="ready"` and primary status `Ready`;
- zero `ConsoleAtmosphere` children under `[data-jarvis-atmosphere]`;
- zero full-screen ParticleField canvases and one remaining Orb canvas;
- static grid with computed `animationName: none`, `animationDuration: 0s`, and opacity `0.1`;
- one `.jarvis-field-drift` owner, with no rendered points in the unavailable preview;
- zero computed CSS animations in the browser’s computed-style inventory;
- zero console errors; only the existing `THREE.Clock` deprecation warning.

The runtime browser surface does not expose `document.getAnimations()`, so the inventory uses per-element computed animation styles plus source ownership. The failed API probe did not alter the page or evidence; the computed-style inventory was rerun successfully.

## Verdict

**Rest ambient-loop gate: verified at the available public-preview branch.** The observed rest DOM has no generic atmosphere or particle loop, a static grid, and only the two plan-permitted source owners (Orb Presence Breath and Field drift; the empty unavailable field has no active computed CSS animation). Authenticated active-mode and populated-field motion remain outside this rest-gate proof.
