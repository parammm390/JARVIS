# JARVIS P2 exit-gate runtime audit — 2026-08-02

Scope: canonical `/jarvis` only. `/demo` was not opened or edited. The initial
read-only audit below did not click a production control, submit an instruction,
read credentials, or perform a deployment. The authorized deployment and
canonical-route reconciliation are recorded in the final section below.

## Current worktree browser surface

- `/Users/paramdave/FINNOR` is a symlink to `/Users/paramdave/Desktop/FINNOR`;
  both paths resolve to the same physical Git worktree. The existing Next
  process on port `3000` was therefore not a different checkout.
- A fresh snapshot of `http://localhost:3000/jarvis` from that worktree rendered
  the unauthenticated branch: the
  `PUBLIC PREVIEW` label, the compact unavailable Setup Rail, `JARVIS Presence
  Core`, the invitation, and a `Sign in` link. It did not render the authenticated
  Command Dock or the `data-voice-state` status row. This is preview/layout
  evidence only; it is not a microphone, Vapi, or authenticated-kernel run.
- A separate port `3001` server was also started from the same physical worktree
  during the audit and showed the same preview boundary; it was not a second
  checkout.
- The current `.env.local` was checked for the dedicated public browser-assistant
  variable by presence only. Values and secrets were not printed or recorded.

## Published canonical route

- Read-only `https://finnorai.com/jarvis` rendered at a `1470×779` browser
  viewport with `Ready`, the unavailable Setup Rail, one voice-control button
  labelled `Tap to talk, or hold and release to push to talk`, and no
  `data-voice-state` status rows.
- The published DOM therefore does not match the current dirty worktree's P2
  voice-state surface. It is not used as proof of the current implementation.
- The observed console output contained repeated `THREE.Clock: This module has
  been deprecated. Please use THREE.Timer instead.` warnings and no console
  errors. This remains warning evidence, not a warning-free claim.
- A fresh read-only inspection of the existing authenticated production tab
  rendered `Ready`, the unavailable Setup Rail, one Presence Core, one Command
  Dock/textbox, and one voice-control button with no `PUBLIC PREVIEW` label. DOM
  markers were `data-liveframe-mode="ready"`, `data-primary-status="Ready"`,
  `data-setup-state="unavailable"`, `voiceControls: 1`, and
  `voiceStates: []`; the current dirty P2 source renders a `data-voice-state`
  status row, so this is still a pre-P2/version-mismatched deployment and is
  not current-worktree P2 runtime proof. No control was clicked and no
  instruction or voice session was started.
- A pre-existing `http://localhost:3000/jarvis/login` tab timed out while being
  inspected. It produced no usable DOM result and is not counted as local
  authentication or runtime evidence.

## Route/source boundary

- `src/app/jarvis/page.tsx` renders `PersonalizedHome`; without a session it
  renders the preview `InstructionThreadBridge` branch.
- `src/app/jarvis/bridge/page.tsx` renders a separately documented legacy
  `Bridge` route and is explicitly not the replacement for `/jarvis`. It was not
  used to manufacture P2 evidence.

## Source correction in the continuation

- `useVapiSession.tsx` now ignores stale `speech-start`, remote
  `volume-level`, and local `local-volume-level` callbacks after the shared call
  is inactive or a stop is in progress. Remote and local levels are reset on
  call start and every teardown/error path, so a late SDK callback cannot revive
  the visible speaking or mic state.
- Verification ran from the same physical worktree: the focused P2/kernel run
  passed 5 files / 70 tests; the full unit suite passed 34 files / 381 tests;
  ESLint and `git diff --check` passed; a direct `npx tsc --noEmit --pretty
  false` rerun exited `0` with no diagnostics.
- A further source audit found two post-teardown callback paths in the same
  hook: `message` could accept a flushed final transcript after call-end, and
  `local-audio-level-observer-error` could repopulate an idle error surface.
  Both now require the real connecting/active lifecycle boundary. The focused
  P2 run passed 4 files / 36 tests, the full suite passed 34 files / 381 tests,
  TypeScript, scoped ESLint, and `git diff --check` passed, and the final public
  Playwright subset passed all 5 tests in 21.5 s.
- After the source edit, the old port-3000 process exited before its refresh;
  the refresh showed `ERR_CONNECTION_REFUSED`. A fresh current-worktree server
  on port `3001` was started, but the browser-control URL policy rejected that
  navigation. No workaround or alternate browser surface was used, and no
  additional runtime evidence is claimed from that blocked attempt.

## Test-capability boundary

- `@testing-library/react` is installed, but the repository has no installed
  `jsdom`, `happy-dom`, or `@testing-library/dom` runtime and `vitest.config.ts`
  explicitly fixes the unit environment to `node`. Rendering
  `MicControlButton` or the stateful Vapi hook in unit tests would therefore
  require an unapproved environment change or a fabricated browser.
- Playwright is configured for local E2E, but the authenticated specs skip when
  `TEST_OWNER_EMAIL`/`TEST_OWNER_PASSWORD` are absent. No credentials were
  supplied or read during this audit, so those specs do not close the P2
  authenticated/device gate.
- A presence-only recheck found a `NEXT_PUBLIC_VAPI_WEB_ASSISTANT_ID` entry in
  `.env.local`; its value was not read or recorded. `TEST_OWNER_EMAIL` and
  `TEST_OWNER_PASSWORD` remain absent, so no authenticated current-worktree
  Playwright run was attempted.

## Public regression check

- The first run of `CI=1 npx playwright test e2e/jarvis-public.spec.ts
  --project=desktop-chromium --reporter=line` executed 5 tests: 4 passed and 1
  failed because the test still expected `Setup status unavailable`, while the
  current Plan §2.6/source contract renders `Connection status is unavailable.`
- The stale assertion in `e2e/jarvis-public.spec.ts` was corrected to the exact
  current contract. The identical command then passed all 5 tests in 25.2 s:
  public preview truthfulness/console filtering, sign-in affordance, logged-out
  privacy affordance, 375 px overflow, and login fields.
- The Playwright web server emitted the existing Sentry ESM-module warning
  during startup. The browser test itself reported no unexpected console errors
  or page errors. This is public-preview regression evidence only and does not
  prove authenticated voice, microphone permission, screen-reader, audio, or
  event-to-pixel timing behavior.

## Gate conclusion

- Source/test evidence supports the one-Vapi-instance plus one-authenticated-
  submit-path exit-gate item.
- No authorized current-worktree authenticated browser session, device
  microphone, permission trace, 390 px pointer recording, responsive recording,
  screen-reader run, AudioContext measurement, or event-to-pixel/barge-in timing
  measurement was available. The remaining P2 runtime and score gates stay open.
- The same missing-evidence condition has now recurred across more than three
  consecutive P2 exit-gate audits. This audit therefore records the goal as
  blocked pending a user-supplied/authorized current-worktree authenticated
  device surface or explicit authorization for the current P2 deployment and
  safe test path. This is not a P2 completion claim: the supported gate remains
  1/7 and the score remains 10/100.

## Authorized current-worktree deployment and canonical reconciliation — 2026-08-02

- The current dirty worktree was preserved. The documented prebuilt path was
  executed: `npx vercel build --prod` exited `0` and completed `.vercel/output`.
  The build emitted the existing non-fatal Sentry/ESM warning for
  `@apm-js-collab/tracing-hooks/hook-sync.mjs`; no build failure occurred.
- Under the recorded user deployment authorization,
  `npx vercel deploy --prebuilt --prod --yes` created
  `dpl_AZgd6ztBr8UewqvCL5WKg9m4EaHK` for `finnor-agency`. The CLI reported
  deployment completion and alias `https://finnorai.com`; `npx vercel inspect
  ... --wait` confirmed target `production` and status `Ready`.
- `npx vercel curl /jarvis --deployment
  https://finnor-agency-add6ot8ta-bloodride2-3212s-projects.vercel.app -- -I`
  returned HTTP/2 200 with `x-matched-path: /jarvis`. A direct read-only curl to
  `https://finnorai.com/jarvis` returned `200`.
- A fresh Chrome tab was opened at `https://finnorai.com/jarvis` and read
  without clicks or submission. Title: `FINNOR JARVIS — Live AI Command Center
  for Water Treatment | FINNOR`. DOM snapshot: `Ready`; visible `PUBLIC PREVIEW`;
  Setup rail copy `Finish setup to unlock every action.` and `Connection status is
  unavailable.`; one `JARVIS Presence Core` control labelled `Tap to talk, or
  hold and release to push to talk`; invitation `Tell JARVIS what you need.`; and
  a `Sign in` link.
- Read-only marker evaluation returned: `data-liveframe-mode="ready"`,
  `data-primary-status="Ready"`, `data-setup-state="unavailable"`, one
  `[data-voice-control]`, one `[data-voice-state]` with
  `data-voice-state="idle"`, zero text inputs/textarea controls, and one exact
  `Sign in` link. `browser.user.openTabs()` returned `[]`, so no existing
  authenticated Chrome tab was available for this continuation.
- These facts resolve the prior published-version mismatch (B4-08) but do not
  close the P2 runtime gates: the observed tab is unauthenticated public preview.
  No microphone permission trace, tap/hold/release-at-390 recording, partial/final
  transcript recording, screen-reader run, AudioContext measurement, ≤100 ms
  input measurement, or ≤200 ms barge-in measurement was performed or claimed.
  P2 remains 1/7; the evidence-backed score remains 10/100; phases complete
  remains 0/6; P3 was not started.

## Supplied Chrome current-worktree runtime reconciliation — 2026-08-03

### Scope and surface identity

- `chrome.user.openTabs()` returned the supplied production tab at
  `https://finnorai.com/jarvis` and a pre-existing localhost login tab. The
  production tab was claimed read-only; no credentials, cookies, local storage,
  or secrets were read. The attached screenshot was treated as static context,
  not as dynamic runtime proof. It visibly includes a debugger banner and a
  robot-like graphic; the current DOM marker audit found no matching image or
  mascot selector, so no source attribution is made for that graphic.
- Before reload, the claimed production tab had no `PUBLIC PREVIEW` or `Sign in`
  marker and exposed the Presence Core/Dock voice control. The initial voice
  control count was one and no current voice-state row was present; this was the
  pre-reload/open bundle and is not substituted for the current post-reload DOM.

### Pre-reload voice observations

- At a temporary 390×844 viewport, one unique voice control was clicked. The
  observed sequence was `Connecting microphone`/pressed, then `Listening` with
  the voice session live. After approximately nine seconds without detected
  microphone audio, the page displayed the exact warning:
  `No microphone audio detected — check permission or mute.`
- While that voice session was open, the page also displayed the transcript
  `What else can you do?`, an understood/context block, a one-of-one received
  and sent `Answer business question` plan/action, and a receipt. No text was
  entered and no Send control was clicked. Because the transcript provenance
  was not established, this event is recorded as an observed page/backend event,
  not as intentional user speech or authenticated submit evidence. The receipt
  displayed a read-only business summary and an approval status; no follow-up
  approval or business action was taken.
- The pre-reload 390 tap/cancel check observed Connecting after the first click
  and returned to the Talk/idle affordance after the second click. This is
  lifecycle evidence for the open tab only; it is not the required hold/release
  pointer trace.

### Post-reload current-branch DOM and lifecycle

- Reloading the claimed tab reconciled it to the current deployed branch. At
  390×844 the read-only markers were: URL `/jarvis`, no `PUBLIC PREVIEW`, no
  `Sign in`, `data-liveframe-mode="fault"`,
  `data-primary-status="Needs attention"`,
  `data-setup-state="attention"`, setup copy `6 connections need attention`,
  two `[data-voice-control]` elements (shared Orb and Dock), and three
  `[data-voice-state]` rows: `idle`, `idle`, and `stopped` with
  `StoppedVoice is off. Tap Talk to start.`. The document had no horizontal
  overflow at this viewport (`clientWidth=390`, `scrollWidth=390`).
- A fresh unique Dock Talk control was clicked. After approximately 1.2 seconds
  the two shared controls showed `Connecting microphone`/pressed and the status
  copy showed `Connecting`. After approximately 8.5 seconds the primary runtime
  voice state was `Speaking`; both controls showed `End voice session`/pressed and
  the visible status copy included `JARVIS is speaking. You can interrupt.`.
  Clicking the unique Dock End control returned both controls to Talk/idle and
  the state rows to idle/idle/stopped. No instruction was typed or submitted.
- A fresh unique Dock Talk control also accepted native Space activation. After
  500 ms it showed `Connecting microphone`/pressed. It later settled back to
  idle/stopped during the cleanup wait. This proves keyboard activation was
  observed; it does not measure the ≤100 ms press response or prove a hold/release
  pointer gesture.

### Runtime errors and evidence boundary

- During the post-reload/current-branch lifecycle, the browser emitted these
  observed errors/logs: `KrispSDK - The KrispSDK is duplicated. Please ensure
  that the SDK is only imported once.`, `Failed to add Module: AbortError:
  Unable to load a worklet's module.`,
  `KrispSDK:createNoiseFilter AbortError: Unable to load a worklet's module.`,
  `Error when starting local audio level observer!`,
  `Uncaught (in promise) KrispInitError: Error creating krisp filter: Error:
  WORKLET_NOT_SUPPORTED`, and `Error unloading krisp processor:
  WASM_OR_WORKER_NOT_READY`. The existing `THREE.Clock` warning and the app's
  `[JARVIS] force-stopped local mic track(s) on end` log were also observed.
- The installed `@vapi-ai/web` package is `2.6.1`. Its source starts Daily's
  optional noise-cancellation processor after joining; the current app already
  requests the raw `processor: { type: "none" }` input on `call-start`. A
  debugger-controlled worklet failure alone does not establish that a
  source-owned SDK monkey-patch or dependency upgrade is safe, so no such change
  was made.
- No real local-mic amplitude, Hearing state, partial-to-final transcript timing,
  authenticated submit-latency trace, hold/release pointer-down/up trace,
  screen-reader review, AudioContext measurement, ≤100 ms event-to-pixel
  measurement, or ≤200 ms barge-in measurement was obtained. The remaining P2
  gates therefore remain open; P2 stays at 1/7 and the evidence-backed score
  stays at 10/100.

### Verification after reconciliation

- Focused P2 run: **6 test files, 73 tests passed**.
- Full unit run: **34 test files, 381 tests passed**.
- `npx tsc --noEmit --pretty false`: **exit 0**.
- Scoped P2 ESLint: **exit 0**.
- `git diff --check`: **clean**.
