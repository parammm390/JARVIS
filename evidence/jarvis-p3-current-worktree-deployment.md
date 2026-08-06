# P3 current-worktree deployment reconciliation — 2026-08-03

## Authorization and deployment result

The state ledger already records explicit user authorization to publish Phase 1
and all completed work. The current P3 implementation was built and published
under that authorization using the repository-linked `finnor-agency` project.

- The first prebuilt publish attempt failed because a stale generated
  `.vercel/output` tree caused `EEXIST` while creating
  `demo/[slug].func` and left no usable `config.json`.
- The generated output directory was moved, recoverably, to
  `/tmp/finnor-vercel-output.Na9bvP/output`; no source, database, or user data
  was removed.
- A clean `npx vercel build --prod` then completed in 24 seconds. It emitted the
  existing Sentry ESM warning and the existing edge-runtime static-generation
  warning; TypeScript and page generation completed.
- `npx vercel deploy --prebuilt --prod --yes` completed as deployment
  `dpl_7zEG4p8wimDXiyA9KK3VqpuWJpZm`.
- `npx vercel inspect --wait` reported `status Ready`, target `production`, and
  aliases including `https://finnorai.com`.

## Read-only Chrome reconciliation

The existing Chrome tab at `https://finnorai.com/jarvis` was claimed and
reloaded read-only after the deployment. The current DOM had no `PUBLIC PREVIEW`
text and no `Sign in` link. It exposed the current LIVEFRAME markers, two voice
controls, and the three current voice-state rows (`idle`, `idle`, `stopped`).

At a 1440×1000 viewport, one bounded DOM sample reported:

```text
liveframeMode=ready
primaryStatus=Ready
setupState=unavailable
scrollWidth=1440
scrollHeight=1000
voiceControls=2
voiceStates=idle,idle,stopped
publicPreview=false
signIn=false
```

At 390×844, the read-only runtime had no horizontal overflow (`scrollWidth=390`)
and two voice controls. The visual capture initially showed the compact mobile
Ready/setup/Presence/Dock composition; a later bounded DOM sample reported the
transport settling into `fault` / `Needs attention` with `setupState=attention`.
That temporal change is recorded as observed runtime behavior, not normalized
into a fabricated lifecycle state.

The browser console contained the existing repeated `THREE.Clock` deprecation
warning. No controls were clicked, no instruction was typed or submitted, no
microphone permission was accepted, no approval was selected, and no external
workflow action was performed.

## Measurement follow-up deployment

After the bounded live owner journey, a measurement-only follow-up added a
read-only inspection copy around the existing trace event-received→next-paint
bus and non-visual Thread `data-*` attributes. The focused and full test results
and the live limitations are recorded in
[`jarvis-p3-trace-metrics-follow-up.md`](/Users/paramdave/FINNOR/evidence/jarvis-p3-trace-metrics-follow-up.md).

The latest publish was deployment `dpl_9W82UCm8TkDBZow5e2jJynBjDv6e`, inspected
as `READY` and aliased to `https://finnorai.com`. The owner probe after this
publish hit the observed rate-limit response; after a 60-second cool-down the
route returned to `Needs attention` / `Connection status is unavailable.` with
no Thread blocks. This does not supply live event→pixel, CLS, restore, or score
proof.

## What this proves and does not prove

This resolves the deployment/version mismatch and supplies a current-worktree
browser surface for the next evidence attempt. It does not prove the P3
ready→captured→understanding→planning→clarifying/approval→executing→verifying
→terminal lifecycle, retry plus refresh/restore in one live recording, live
context/plan event→pixel timing, production migration application, or an
authoritative ≥87/100 score. The P3 exit gate therefore remains 3/7 and the
ledger score remains 10/100.
