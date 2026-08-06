# P4.T8 verification — bounded performance pass

Date: 2026-08-03

## Source and automated checks

- Added `kernel/execution-metrics.ts` and **5 tests** for real event receipt, next-paint closure, duplicate delivery, poll/SSE filtering, summaries, and browser inspection.
- Wired the shared `data-core.ts` terminal-transition boundary to the metric bus; `WorkflowTheater` marks real step/run state transitions at `requestAnimationFrame`.
- Updated the labelled execution fixture to use the same kernel selector bridge for intercepted workflow GET data; it does not fabricate an event or mutate workflow state.
- While a linked workflow is visible, `ThreadBridge` defers `ConsoleAtmosphere` and `ParticleField`; graph nodes no longer apply six simultaneous `backdrop-filter` surfaces.
- Focused metric/transition/presentation checks: **3 files / 20 tests passed**.
- Full unit run after the instrumentation: **38 files / 417 tests passed**.
- TypeScript, lint, and `git diff --check`: passed. The final source-only lint run reported **no ESLint warnings or errors**.

## Labelled six-lane fixture recording

Method: authenticated Supabase session, local current-worktree dev server, real Thread/Kernel/WorkflowTheater component tree, workflow GET intercepted with one six-step run linked to `fixture-node-0` … `fixture-node-5`, no POST/approval/run-control call, headless Chromium, 2.5-second frame sample, nearest-rank p95 frame interval converted as `1000 / p95FrameMs`. The fixture was visibly labelled `FIXTURE · execution`.

Final-source screenshots and DOM assertions are in:

- [`fixture-six-lane-1440.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/fixture-six-lane-1440.png)
- [`fixture-six-lane-768.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/fixture-six-lane-768.png)
- [`fixture-six-lane-390.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/fixture-six-lane-390.png)

The final screenshot pass reported `data-workflow-scope="action-ids"`, six graph nodes, no blueprint/replay text, and no horizontal overflow at all three widths.

Normal-motion samples were not gate-passing:

| Pass | 1440×1000 | 768×1024 | 390×844 | Poll event→pixel samples |
|---|---:|---:|---:|---|
| Initial six-lane recording | 29.67 FPS p95 | 29.24 FPS p95 | 10.00 FPS p95 | 54.4 / 70.9 / 45.2 ms |
| After node blur removal | 19.80 FPS p95 | 19.96 FPS p95 | 29.85 FPS p95 | 92.1 / 130.7 / 67.7 ms |
| After linked atmosphere/particle deferral | 15.02 FPS p95 | 20.00 FPS p95 | 29.50 FPS p95 | 101.3 / 96.3 / 106.7 ms |

The samples varied materially between bounded runs; they are reported exactly, not averaged into a favorable claim. The latest normal-motion pass remains below the **55 FPS p95** target.

The reduced-motion comparison measured **57.47 / 56.50 / 56.50 FPS p95** at 1440/768/390. This confirms the reduced posture is substantially lighter; it does not certify normal motion.

The no-graph execution baseline, with the same authenticated fixture tree and empty intercepted workflow GET, measured **19.92 FPS p95 at 768** and **19.76 FPS p95 at 390**. This is diagnostic context only, not a pass.

The final normal six-lane DOM carried one real-poll metric per viewport in the captured transition window. The separate SSE sample count is **0** because the current workflow status source is polling; no SSE latency claim is made.

## Production/runtime blockers

- The required in-app Browser bootstrap failed with the exact environment error `Cannot redefine property: process`.
- Production `/jarvis/next` is HTTP **404**; production `/jarvis` is the legacy command-center route and does not expose the current instruction-scoped Weave. Therefore no authenticated production approval→linked-run recording exists for this pass.
- Two bounded `npm run build` attempts (the second with `NEXT_DISABLE_ESLINT=1 NEXT_TELEMETRY_DISABLED=1`) reached `Creating an optimized production build ...` without a completion verdict. The identified build processes were stopped and neither attempt is counted as a pass.
- Initial JS gzip, five cold Lighthouse runs, input latency, CLS, and a real authenticated linked workflow remain unmeasured.

## Gate decision

P4.T8 remains **unchecked**. The fixture proves the source instrumentation and the responsive six-node DOM shape, but it does not close the normal-motion FPS gate, real linked-workflow evidence gate, bundle gate, or cumulative score.

## Continuation — source budget pass and runtime boundary (2026-08-03)

The active Weave now has an explicit P4.T8 budget posture: the linked-workflow Presence Core defers the 14,000-particle WebGL renderer while retaining the semantic static Orb, and flowing SVG lanes no longer add a redundant blurred path or duplicate halo animation. The real state path and throughput-earned particulate dots remain. Source verification after this change passed **38 files / 417 tests**, TypeScript, lint with no warnings/errors, and `git diff --check`.

The official `e2e/jarvis-p4-verification-fixtures.spec.ts` exposed a concrete fixture defect on its first run: its intercepted setup-status response omitted the real top-level `actionTypes` envelope, so the actual SetupRail crashed before the receipt could render (**1 failed, 3 did not run**). The fixture was repaired to fetch and preserve the real setup-status envelope and override only the labelled emulator/native bindings. On the next healthy-server run, the two receipt assertions passed; the real-session P4.T7 command-palette assertion did not observe the palette and the final approval assertion did not run (**2 passed, 1 failed, 1 did not run**). This is recorded as fixture/runtime evidence, not as a product pass.

A fresh single-project Playwright rerun then reached the local listener but the Next dev server remained stuck at `Compiling /jarvis/login ...`; a direct 20-second GET timed out with HTTP `000`. The run was stopped with exit **130**, the listener was confirmed absent afterward, and no browser assertions or workflow-control POSTs occurred. A manual `npm run dev` reproduced the same compile stall after `Ready in 2.8s`. The generated `.next` cache relocation was attempted only as a recoverable diagnostic, stalled across volumes, was stopped, and left the original cache in place.

The mandated in-app Browser bootstrap still returns exactly `Cannot redefine property: process`. No new numeric FPS, bundle, Lighthouse, CLS, input, SSE, or authenticated linked-workflow result is claimed. P4.T8 and all P4 exit gates remain open.

## Continuation — official fixture recovery and corrected responsive measurement (2026-08-03)

The official `e2e/jarvis-p4-verification-fixtures.spec.ts` was re-run against the repaired current-worktree dev server and finished **4 passed in 34.5s**. The four assertions covered the real predicted↔actual receipt (`100% matched`, sandbox provenance, and no raw JSON), the no-prediction exact literal, the P4.T7 `Control+K` → Operations overlay path, and the approval-card predicted outcome. The test now waits for the real instruction textbox readiness boundary. The intercepted harness observed no approval/workflow-control POST. This is local fixture evidence, not authenticated production linked-workflow proof.

Two concrete test/product defects found during recovery were repaired. The setup-status fixture now fetches and preserves the real top-level `actionTypes` envelope and overrides only the labelled emulator/native bindings; explicit JSON response headers prevent stale content-encoding/content-length metadata from corrupting the response. The visible palette also explicitly restores `pointer-events-auto` because its `CommandRail` parent is `pointer-events-none`; the real keyboard/click path then passed. No setup, approval, workflow, migration, deployment, external data, or `/demo` fact was invented or changed.

The strongest corrected responsive six-lane recording used explicit `page.setViewportSize()` values `1440×1000`, `768×1024`, and `390×844` (an earlier custom run that accidentally created all pages at 1440px was discarded). It used a visibly labelled `FIXTURE · execution` run, six exact `fixture-node-0` … `fixture-node-5` action IDs, the real Thread/Kernel/WorkflowTheater tree, read-only intercepted workflow/receipt GETs, and a 2.5-second requestAnimationFrame sample. Latest normal-motion p95 frame results were **54.054 FPS / 18.5 ms** at 1440, **54.945 FPS / 18.2 ms** at 768, and **54.348 FPS / 18.4 ms** at 390. The earlier corrected sample was `56.497 / 53.476 / 54.054 FPS`; both are retained to show measurement variance. The latest sample remains below the Plan’s **≥55 FPS p95** target and does not close P4.T8.

The corrected run also observed six graph nodes, exact action-ID scope, no blueprint/replay text, no horizontal overflow, and zero intercepted POSTs. Valid final-source screenshots are [`current-six-lane-field-paused-1440.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/current-six-lane-field-paused-1440.png), [`current-six-lane-field-paused-768.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/current-six-lane-field-paused-768.png), and [`current-six-lane-field-paused-390.png`](/Users/paramdave/FINNOR/evidence/jarvis-p4-t8/current-six-lane-field-paused-390.png). The mobile capture shows the vertical causal rail; the invalid all-1440 capture is not cited.

Final source verification after these edits: **38 files / 417 unit tests passed**, TypeScript exit `0`, lint with no warnings/errors, and `git diff --check` exit `0`. The normal-motion, real production linked-workflow, initial-JS, Lighthouse, input, CLS, SSE/poll, and authoritative score gates remain unproven; the mandated in-app Browser still returns `Cannot redefine property: process`, and production `/jarvis/next` remains unavailable for the current Weave. P4.T8 remains unchecked.

## Continuation — active-Weave filter budget and regression result (2026-08-03)

The active linked Weave now marks its real visibility with `data-liveframe-weave="true"`. In that state only, the command dock and header diagnostics disclosure drop their non-essential `backdrop-blur` filters while retaining solid surfaces, content, controls, focus behavior, and state-linked motion. This was a source-level performance refinement; it is not treated as a runtime budget pass.

After the refinement, the official `npx playwright test e2e/jarvis-p4-verification-fixtures.spec.ts --project=desktop-chromium --workers=1` suite passed **4/4 in 52.0s**. It covered the predicted↔actual/sandbox/no-raw-JSON receipt, the exact no-prediction literal, the P4.T7 keyboard-to-Operations overlay, and the P4.T2 predicted-outcome card. No approval confirmation or workflow-control POST was invoked.

A separate corrected six-lane FPS harness was attempted once with explicit `1440×1000`, `768×1024`, and `390×844` viewports. It did not produce a completed metric because the local authenticated session remained at the authentication/polling boundary. The overlapping local polling later returned `429` responses before the dev server was stopped. No FPS, event→pixel, or product-failure claim is made from that inconclusive run. The latest valid normal-motion sample remains **54.054 / 54.945 / 54.348 FPS p95**, below the Plan’s ≥55 target.

Static verification after this refinement passed again: **38 files / 417 unit tests**, TypeScript exit `0`, lint with no warnings/errors, and `git diff --check` exit `0`. The local listener was stopped and verified absent. P4.T8 remains unchecked because authoritative approval→linked-real-run, normal-motion performance, bundle/Lighthouse/input/CLS/SSE, and score evidence are still missing.

## Continuation — retain live truth, remove redundant active pulse (2026-08-03)

The active Weave still rendered two CSS `animate-ping` pulses through `LiveDot` even though each marker also had a static live-color child. The active-only rule now disables `.animate-ping` under `#workflow-theater` while `data-liveframe-weave="true"`; the static live marker remains visible. No workflow data, API, control, or route behavior changed.

Final source-only verification after this refinement: **38 files / 417 unit tests passed**, TypeScript exit `0`, lint with no warnings/errors, and `git diff --check` exit `0`. No new FPS sample was obtained after the inconclusive harness; the prior valid normal-motion record remains **54.054 / 54.945 / 54.348 FPS p95**, below the Plan target. P4.T8 remains unchecked.

## Continuation — read-only Vercel route/build boundary (2026-08-03)

The connected Vercel read-only audit found project `finnor-agency` and latest production deployment `dpl_DcbEUsJTuiYqzYbZbFhDcWk8W1ju` in `READY`, built from GitHub commit `cb27d47093651ec37ebd8454600e7c907c290d2a` (`gitDirty: "1"`). The listed recent deployments all reference that commit, not the current dirty worktree or the latest local P4 budget edits.

The latest deployment build log completed in **56s** and includes `/jarvis/next` (`397 B / 271 kB` First Load JS) and `/jarvis` (`360 B / 274 kB` First Load JS). These are not gzip values, so they do not close the Plan’s initial-JS budget. The build log also contains the Sentry ESM warning; it is recorded without inferring impact.

The authenticated Vercel deployment fetch for `/jarvis/next` returned HTTP **404**, `x-matched-path: /jarvis/next`, and `NEXT_NOT_FOUND`. The checked-out route guard confirms why: the route intentionally calls `notFound()` unless `NEXT_PUBLIC_JARVIS_NEXT === "1"`. The route is therefore build-present but runtime-disabled in the current production reference; no authenticated current-Weave approval→linked-run recording can be obtained from it. No deployment or environment-variable mutation was performed. P4.T8 remains unchecked.

## Continuation — blocker recheck (2026-08-03)

The final read-only recheck found the same boundary: `src/app/jarvis/next/page.tsx:16` still calls `notFound()` unless `NEXT_PUBLIC_JARVIS_NEXT === "1"`, and the canonical production `/jarvis/next` route still returns HTTP **404**. `git diff --check` passed and no local port-3000 listener remained. No external state was changed. P4.T8 remains unchecked because the current-worktree authenticated Weave still requires an explicitly authorized deployment/environment change.

## Continuation — user-authorized live publication and P5 operational handoff (2026-08-03)

The user explicitly authorized the current Phase 4 worktree to be published live, authorized the required production environment change, authorized one bounded authenticated live instruction, and explicitly directed that FPS not be forced. The first production environment write used `printf '1\\n'`, which stored `NEXT_PUBLIC_JARVIS_NEXT` as `1` plus a trailing newline. Two READY deployments built the route but returned HTTP 404 because the route guard compared the value exactly to `"1"`. The environment variable was corrected with a no-newline value (`printf '1' | npx vercel env add NEXT_PUBLIC_JARVIS_NEXT production --force --yes --non-interactive`); a production pull then verified the exact serialized value `NEXT_PUBLIC_JARVIS_NEXT="1"`.

The final forced production deployment completed successfully:

- Deployment: `dpl_6cCKL7h3tGFEtAP44BHD5xYGjCru`
- Vercel URL: `https://finnor-agency-9z6bzz5jt-bloodride2-3212s-projects.vercel.app`
- Alias: `https://finnorai.com`
- Target/state: `production` / `READY`
- Build log: Next.js `14.2.5`, `38/38` static pages generated, `/jarvis/next` present at `398 B / 273 kB` First Load JS, `Build Completed in /vercel/output [2m]`, then deployment completed

Live checks against the canonical alias returned HTTP **200** for both `/jarvis/next` and `/jarvis`; `/jarvis/next` returned `x-matched-path: /jarvis/next`, `content-type: text/html; charset=utf-8`, and the HTML markers `FINNOR JARVIS` and `Instruction Thread`. The production deployment URL itself remains Vercel-protected as expected; the custom alias was used for the live route check. Build warnings were recorded without being promoted to failures: npm peer/deprecation warnings, the Next.js 14.2.5 security warning, and the existing Sentry ESM warning.

The existing signed-in Chrome FINNOR tab was claimed and navigated to `https://finnorai.com/jarvis/next`. The initial live surface showed the Setup Rail’s `Finish setup` state and `Connection status is unavailable.` The user-authorized bounded instruction `Check the RO membrane stock level` was submitted once. The live UI first showed `Understanding / Building the plan`, `Plan · Drafting`, and `Waiting for the first action from the live plan.` After the real transition settled, the visible states were `Heard`, `Understood`, `Plan · 1 action`, `Execution · Execution recorded`, and `Receipt · Complete`, with final status `Done`.

The exact live receipt facts were recorded literally: `1 of 1 action sent.`; `Check stock level · RO membrane · sent`; objective `single_action: check_stock_level`; risk `medium`; policy `f02f896e · v2`; `finalized`; `fieldChanges none`; evidence `workflow_step:2f1ba383-a2d5-4609-a000-9379ca1a503f`; approval `awaiting approval`; actual output id `3dc9d944-c710-44eb-afe5-df0b26053474`; SKU `RO-MEM-75`; name `RO Membrane 75 GPD`; quantity `6`; reorder threshold `3`; status `success`; `expected.answered yes`; and `Actual outcome not recorded yet.` The receipt anchor was `#receipt-42038263-2d61-4ec4-bf15-98ab2699e18c`. No separate approval control was clicked, and the `success` field is not treated as proof of an external inventory mutation. The final DOM exposed `data-liveframe-mode="resolved"`, `data-liveframe-weave="true"`, and `data-thread-restored="false"`; no `data-workflow-scope` or `data-action-id` attribute was observed in that resolved DOM snapshot.

FPS was not re-run in this continuation per the user’s explicit instruction. The latest valid normal-motion six-lane record remains **54.054 / 54.945 / 54.348 FPS p95** at 1440/768/390, below the Plan’s ≥55 target; it is retained as diagnostic evidence and not treated as a pass. Existing source/fixture verification remains **38 files / 417 unit tests**, TypeScript exit 0, lint with no warnings/errors, and `git diff --check` exit 0.

**Handoff decision:** the current Phase 4 implementation is published and the live `/jarvis/next` route is available for P5 work. This is an operational handoff, not a formal Plan certification: P4.T8 remains unchecked, P4 exit gates remain **0/7**, the Phase 4 task checklist remains **7/8 = 87.5%**, the accepted score remains **10/100**, and phases complete remains **0/6**. No unsupported FPS pass, approval→linked-real-workflow certification, external side-effect claim, or score movement is recorded. The exact next task is **P5.T1 — Gate Rise**.

## Continuation — 2026-08-04 current-build and Lighthouse measurements

The current worktree was built after stopping the local dev server: `npm run build` exited **0**, Next.js `14.2.5` generated **38/38** static pages, and the route table reported `/jarvis` at `361 B / 278 kB` First Load JS and `/jarvis/next` at `396 B / 275 kB`. The existing Sentry ESM warning and edge-runtime warning were emitted; no warning-free claim is made.

The post-build `.next/app-build-manifest.json` calculation used the complete `/jarvis/page` client-file list and gzip level 9 for each listed file. It measured **20 files, 947,684 raw bytes, 283,285 gzip bytes** for `/jarvis/page`; `/jarvis/next/page` measured **19 files, 939,454 raw bytes, 280,193 gzip bytes**. The `/jarvis` initial-JS target is **≤250,000 gzip bytes**, so the current `/jarvis` measurement misses by **33,285 bytes**. The measurement is a failure result, not a pass inferred from the First Load JS column.

The provided Lighthouse gate was run against the live canonical `https://finnorai.com/jarvis/next` with a fresh Chrome process for each sample. The completed **3-sample desktop diagnostic** returned performance `[0.95, 0.99, 0.99]` (median **0.99**, minimum **0.95**), accessibility `1.00` on every sample, and CLS `0` on every sample; the script exited `0`. This is strong partial evidence, but the Plan requires five cold desktop and mobile runs, so P6.T3 and the full P4.T8 performance gate remain open. A local current-build three-sample diagnostic returned performance `[0.40, 0.45, 0.44]`, accessibility `1.00`, and CLS `0`; it is retained only as local-runtime context.

The valid six-lane normal-motion record remains **54.054 / 54.945 / 54.348 FPS p95** at 1440/768/390, below the `≥55` target; poll event→pixel samples remain **101.3 / 96.3 / 106.7 ms** and SSE sample count is **0** because this worktree uses poll-only workflow status. Input press→visible-response and an authenticated linked-workflow recording remain unmeasured. P4.T8 stays unchecked.

## Continuation — 2026-08-04 authorized production publication

The verified current worktree was published with `vercel --prod --yes`. Deployment `dpl_7pDCexyXL4xyeod5MPt1qusDATcV` reached `READY` at `https://finnorai.com` with Vercel URL `https://finnor-agency-hdwz1pgdx-bloodride2-3212s-projects.vercel.app`. The remote build generated **38/38** static pages and reported `/jarvis` at `334 B / 204 kB` First Load JS and `/jarvis/next` at `42.8 kB / 274 kB`; the existing Sentry ESM warning and peer/edge warnings were retained as warnings.

Read-only HTTP probes returned **200** for `/jarvis` and `/jarvis/next`. The current in-app browser at `/jarvis` rendered `Ready`, Setup Rail, Presence Core, and the instruction textbox with no horizontal overflow observed. A post-publish 3-sample desktop Lighthouse diagnostic returned performance `[0.98,1.00,1.00]` (median `1.00`), accessibility `1.00` on every sample, and CLS `0` on every sample. This is not the required five cold desktop/mobile set. The required current-deployment voice/device capture, exact 1440/768/390 viewport sweep, current console capture, and a new real safe-workflow smoke were not completed; no P6.T8 or final certification claim is made.

## Continuation — 2026-08-04 initial-graph reduction

The `/jarvis` initial graph was reduced by moving the canonical client-only `InstructionThreadBridge` behind a truthful `next/dynamic` boundary in `PersonalizedHome.tsx`. The loading surface contains only the JARVIS label and `Preparing the instruction thread…`; it does not claim private facts or workflow state. The change preserves the owner Thread implementation and does not change `/demo`.

After a fresh `npm run build`, the route table reported `/jarvis` at `333 B / 204 kB` First Load JS. The complete `/jarvis/page` manifest list measured **11 files, 697,868 raw bytes, 209,058 gzip bytes**, which is **40,942 bytes below** the Plan’s 250,000-byte gzip limit. `/jarvis/next/page` remained at `279,246 gzip bytes`; its separate current-Weave route is not the `/jarvis` initial-JS target.

Source verification after the boundary change passed **38 files / 420 unit tests**, TypeScript, lint with no warnings/errors, and `git diff --check`. A local production server built from this worktree produced a completed 3-sample desktop Lighthouse diagnostic of performance `[0.97,0.98,0.96]` (median `0.97`), accessibility `1.00` on every sample, and CLS `0`. This still does not substitute for the Plan’s five cold desktop/mobile runs. The dynamic boundary closes the current initial-JS budget gap, but P4.T8 remains open for the below-target six-lane FPS, five-run/mobile coverage, input timing, SSE coverage, and authenticated linked-workflow recording.
