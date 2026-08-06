# P1 rest dead-zone — final verdict

Final route-local changes:

- `RestPrompt` no longer reserves `min-h-[38vh]` (`min-h-0`), removing the source-owned Presence Core → invitation gap.
- Public preview only gets `jarvis-canvas--preview` padding of 32 px plus safe-area inset and an inline `Sign in` CTA. The owner `CommandRail` path and its clearance remain unchanged.
- Public preview only removes the owner-only mobile rest-prompt bottom padding.
- Ready-only rest gating removes the generic `ConsoleAtmosphere` and `ParticleField` standing loops.

## Final measured semantic gaps

| CSS viewport | Setup → Presence | Presence Core → invitation | Invitation → preview CTA | Horizontal overflow | Document height |
|---|---:|---:|---:|---|---:|
| 1440×1000 | 24 px | 24 px | 56 px | none | 1000 px |
| 768×1024 | 32 px | 24 px | 56 px | none | 1024 px |
| 390×844 | 32 px | 24 px | 56 px | none | 844 px |

The grid floor is decorative field depth, not a semantic element; its invitation-to-grid distances are retained in the raw metrics but are not used as a dead-zone claim. Every adjacent meaningful element in the available preview composition is ≤96 px.

## Verdict

**P1 dead-vertical-zone gate: verified for the available public-preview rest composition.** The evidence does not claim an authenticated owner rest screenshot; the owner path remains source-preserved and must be exercised when authenticated evidence is available.
