# P1.T4 — seven signature moments

Captured 2026-08-08 from the local canonical route `/jarvis/next` with the visibly labelled `signature-journey` fixture. The fixture advances the existing Thread/Orb/scene component tree only; it does not call the kernel or create tenant data.

## Verified

- `npx playwright test e2e/jarvis-p1-signature-moments.spec.ts --project=desktop-chromium --workers=1`: **3 passed**.
- The deterministic journey observed source markers for `wake`, `gather`, `draw`, `clamp`, and `settle` at 1440×1000 and reduced-motion 390×844.
- Every marker carried its source label: voice session, `instruction_events.context_retrieved`, `instruction_events.action_created · domain_actions`, `instruction machine awaiting_approval`, or `instruction_events.completed · authoritative receipt`.
- All journey snapshots reported `scrollWidth` equal to the viewport width: 1440 and 390 respectively.
- Restored `listening`, `plan`, `approval`, and `receipt` fixtures asserted zero replay of their one-shot `wake`, `draw`, `clamp`, or `settle` marker.
- `npx vitest run`: **43 files / 461 tests passed**. The signature contract specifically passed **12 tests**, including exact v6 duration/easing ranges, source-edge gating, reduced-motion end states, and restored suppression.
- `./node_modules/.bin/tsc --noEmit --pretty false`: passed.
- `npm run lint`: passed with no warnings or errors.
- `git diff --check`: passed.
- Browser run recorded no unexpected console/page errors; the only filtered browser errors were the existing unauthenticated 401 responses.

## Recording artifacts

- [1440 signature journey video](/Users/paramdave/FINNOR/test-results/jarvis-p1-signature-moment-8b4bd-re-deterministic-at-desktop-desktop-chromium/video.webm)
- [390 reduced-motion signature journey video](/Users/paramdave/FINNOR/test-results/jarvis-p1-signature-moment-016aa--end-states-at-mobile-width-desktop-chromium/video.webm)
- [restored no-replay video](/Users/paramdave/FINNOR/test-results/jarvis-p1-signature-moment-185f8-ne-shot-signature-entrances-desktop-chromium/video.webm)

The production Ignite marker remains tied to a real workflow step transition into `leased`, and Recover remains tied to transport degraded → healthy or a legal workflow recovery. No authenticated run or transport-reconnect event was available here, so neither was fabricated in the fixture recording; both source-edge contracts are covered deterministically in `src/components/jarvis/kernel/signature-moments.test.ts`.

